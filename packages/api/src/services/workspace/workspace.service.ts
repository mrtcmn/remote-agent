import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, sshKeys, projects } from '../../db';

export interface SkillConfig {
  name: string;
  content: string;
}

export interface HookHandler {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

export interface HookConfig {
  hooks: Record<string, HookMatcher[]>;
}

export interface PairWorkspaceOptions {
  sshPrivateKey?: string;
  sshPublicKey?: string;
  skills?: SkillConfig[];
  hooks?: HookConfig;
  claudeSettings?: Record<string, unknown>;
}

export class WorkspaceService {
  private workspacesRoot: string;
  private sshKeysRoot: string;
  private configRoot: string;

  constructor(opts?: { workspacesRoot?: string; sshKeysRoot?: string; configRoot?: string }) {
    this.workspacesRoot = opts?.workspacesRoot || '/app/workspaces';
    this.sshKeysRoot = opts?.sshKeysRoot || '/app/ssh-keys';
    this.configRoot = opts?.configRoot || '/app/config';
  }

  async createUserWorkspace(userId: string): Promise<string> {
    const userPath = join(this.workspacesRoot, userId);
    await mkdir(userPath, { recursive: true });
    await mkdir(join(userPath, '.claude'), { recursive: true });
    return userPath;
  }

  async pairWorkspace(userId: string, opts: PairWorkspaceOptions): Promise<void> {
    const userPath = await this.createUserWorkspace(userId);

    // 1. Store SSH keys
    if (opts.sshPrivateKey) {
      await this.storeSSHKey(userId, opts.sshPrivateKey, opts.sshPublicKey);
    }

    // 2. Store custom skills
    if (opts.skills?.length) {
      await this.storeSkills(userId, opts.skills);
    }

    // 3. Store custom hooks (merged with notification hooks)
    await this.storeHooks(userId, undefined, undefined, opts.hooks);

    // 4. Store Claude settings
    if (opts.claudeSettings) {
      await this.storeSettings(userId, opts.claudeSettings);
    }
  }

  async storeSSHKey(userId: string, privateKey: string, publicKey?: string): Promise<string> {
    const userKeysDir = join(this.sshKeysRoot, userId);
    await mkdir(userKeysDir, { recursive: true });

    const keyId = nanoid();
    const privateKeyPath = join(userKeysDir, `${keyId}_id_rsa`);
    const publicKeyPath = join(userKeysDir, `${keyId}_id_rsa.pub`);

    await writeFile(privateKeyPath, privateKey, { mode: 0o600 });

    if (publicKey) {
      await writeFile(publicKeyPath, publicKey, { mode: 0o644 });
    }

    // Store in database
    await db.insert(sshKeys).values({
      id: keyId,
      userId,
      name: 'default',
      publicKey: publicKey || '',
      privateKeyPath,
      createdAt: new Date(),
    });

    return keyId;
  }

  async getSSHKeyPath(userId: string, keyId?: string): Promise<string | null> {
    const key = await db.query.sshKeys.findFirst({
      where: keyId
        ? eq(sshKeys.id, keyId)
        : eq(sshKeys.userId, userId),
    });

    return key?.privateKeyPath || null;
  }

  async storeSkills(userId: string, skills: SkillConfig[]): Promise<void> {
    const skillsDir = join(this.workspacesRoot, userId, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });

    for (const skill of skills) {
      const skillPath = join(skillsDir, `${skill.name}.md`);
      await writeFile(skillPath, skill.content);
    }
  }

  async storeHooks(userId: string, sessionId?: string, terminalId?: string, customHooks?: HookConfig): Promise<void> {
    const settingsPath = join(this.workspacesRoot, userId, '.claude', 'settings.json');

    // Build hook commands that read from stdin and pass actual data from Claude CLI
    const baseUrl = 'http://localhost:5100/internal/hooks';
    const sid = sessionId || '';
    const tid = terminalId || '';

    // Notification hook: Claude CLI sends { session_id, message, type } via stdin
    // We read it with jq, add our sessionId/terminalId, and POST to the API
    const attentionCommand = `jq -c '. + {"sessionId": "${sid}", "terminalId": "${tid}"}' | curl -s -X POST "${baseUrl}/attention" -H "Content-Type: application/json" -d @- || true`;

    // Stop hook: Claude CLI sends { session_id, transcript_path, ... } via stdin
    // We read it with jq, add our sessionId/terminalId, and POST to the API
    const completeCommand = `jq -c '. + {"sessionId": "${sid}", "terminalId": "${tid}"}' | curl -s -X POST "${baseUrl}/complete" -H "Content-Type: application/json" -d @- || true`;

    // Default notification hooks using commands that read from stdin
    const defaultHooks: HookConfig = {
      hooks: {
        // Notification hook for user input and permission requests
        Notification: [{
          matcher: 'idle_prompt|permission_prompt',
          hooks: [{
            type: 'command',
            command: attentionCommand,
          }],
        }],
        // Stop hook for task completion
        Stop: [{
          hooks: [{
            type: 'command',
            command: completeCommand,
          }],
        }],
      },
    };

    // Merge custom hooks
    const mergedHooks = this.mergeHooks(defaultHooks, customHooks);

    // Read existing settings if any
    let existingSettings: Record<string, unknown> = {};
    try {
      const content = await readFile(settingsPath, 'utf-8');
      existingSettings = JSON.parse(content);
    } catch {
      // File doesn't exist or invalid JSON, start fresh
    }

    // Merge hooks into settings
    const finalSettings = {
      ...existingSettings,
      hooks: mergedHooks.hooks,
    };

    await writeFile(settingsPath, JSON.stringify(finalSettings, null, 2));
  }

  async storeSettings(userId: string, settings: Record<string, unknown>): Promise<void> {
    const settingsPath = join(this.workspacesRoot, userId, '.claude', 'settings.json');

    // Read existing settings if any
    let existingSettings: Record<string, unknown> = {};
    try {
      const content = await readFile(settingsPath, 'utf-8');
      existingSettings = JSON.parse(content);
    } catch {
      // File doesn't exist or invalid JSON, start fresh
    }

    // Merge new settings (preserving hooks)
    const finalSettings = {
      ...existingSettings,
      ...settings,
    };

    await writeFile(settingsPath, JSON.stringify(finalSettings, null, 2));
  }

  async getProjectPath(userId: string, projectId: string): Promise<string | null> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project || project.userId !== userId) {
      return null;
    }

    return project.localPath;
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project || project.userId !== userId) {
      throw new Error('Project not found');
    }

    // Delete project files
    await rm(project.localPath, { recursive: true, force: true });

    // Delete from database
    await db.delete(projects).where(eq(projects.id, projectId));
  }

  async listUserProjects(userId: string) {
    return db.query.projects.findMany({
      where: eq(projects.userId, userId),
    });
  }

  private mergeHooks(base: HookConfig, custom?: HookConfig): HookConfig {
    if (!custom) return base;

    const merged: HookConfig = { hooks: {} };

    // Copy base hooks
    for (const [event, matchers] of Object.entries(base.hooks)) {
      merged.hooks[event] = [...matchers];
    }

    // Merge custom hooks
    for (const [event, matchers] of Object.entries(custom.hooks)) {
      if (merged.hooks[event]) {
        merged.hooks[event] = [...merged.hooks[event], ...matchers];
      } else {
        merged.hooks[event] = matchers;
      }
    }

    return merged;
  }
}

// Singleton instance
export const workspaceService = new WorkspaceService({
  workspacesRoot: process.env.WORKSPACES_ROOT || '/app/workspaces',
  sshKeysRoot: process.env.SSH_KEYS_ROOT || '/app/ssh-keys',
  configRoot: process.env.CONFIG_ROOT || '/app/config',
});
