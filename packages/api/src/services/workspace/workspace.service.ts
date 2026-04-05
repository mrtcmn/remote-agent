import { mkdir, writeFile, readFile, readdir, rm, chmod, copyFile, cp } from 'node:fs/promises';
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
  private templatesRoot: string;
  private agentHome: string;

  constructor(opts?: { workspacesRoot?: string; sshKeysRoot?: string; configRoot?: string; templatesRoot?: string; agentHome?: string }) {
    this.workspacesRoot = opts?.workspacesRoot || '/app/workspaces';
    this.sshKeysRoot = opts?.sshKeysRoot || '/app/ssh-keys';
    this.configRoot = opts?.configRoot || '/app/config';
    this.templatesRoot = opts?.templatesRoot || '/app/templates';
    this.agentHome = opts?.agentHome || '/home/agent';
  }

  async createUserWorkspace(userId: string): Promise<string> {
    const userPath = join(this.workspacesRoot, userId);
    await mkdir(userPath, { recursive: true });
    await mkdir(join(this.agentHome, '.claude'), { recursive: true });
    return userPath;
  }

  async pairWorkspace(userId: string, opts: PairWorkspaceOptions): Promise<void> {
    const userPath = await this.createUserWorkspace(userId);

    // 1. Store SSH keys
    if (opts.sshPrivateKey) {
      await this.storeSSHKey(userId, opts.sshPrivateKey, opts.sshPublicKey);
    }

    // 2. Deploy global CLAUDE.md + skills from templates
    await this.deployGlobalTemplates(userId);

    // 3. Store custom API-provided skills (on top of template ones)
    if (opts.skills?.length) {
      await this.storeSkills(userId, opts.skills);
    }

    // 4. Store custom hooks (merged with notification hooks)
    await this.storeHooks(userId, undefined, undefined, opts.hooks);

    // 5. Store Claude settings
    if (opts.claudeSettings) {
      await this.storeSettings(userId, opts.claudeSettings);
    }
  }

  private normalizeSSHKey(key: string): string {
    // Remove \r (Windows line endings) and trim whitespace
    let normalized = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    // SSH keys must end with a newline
    if (!normalized.endsWith('\n')) {
      normalized += '\n';
    }
    return normalized;
  }

  async storeSSHKey(userId: string, privateKey: string, publicKey?: string): Promise<string> {
    const userKeysDir = join(this.sshKeysRoot, userId);
    await mkdir(userKeysDir, { recursive: true });

    const keyId = nanoid();
    const privateKeyPath = join(userKeysDir, `${keyId}_id_rsa`);
    const publicKeyPath = join(userKeysDir, `${keyId}_id_rsa.pub`);

    const normalizedPrivateKey = this.normalizeSSHKey(privateKey);
    await writeFile(privateKeyPath, normalizedPrivateKey, { mode: 0o600 });
    await chmod(privateKeyPath, 0o600);

    if (publicKey) {
      const normalizedPublicKey = this.normalizeSSHKey(publicKey);
      await writeFile(publicKeyPath, normalizedPublicKey, { mode: 0o644 });
    }

    // Register key with ssh-agent
    await this.registerWithSSHAgent(privateKeyPath);

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

  private async registerWithSSHAgent(privateKeyPath: string): Promise<void> {
    try {
      // Ensure ssh-agent is running, start one if not
      if (!process.env.SSH_AUTH_SOCK) {
        const agentOutput = await $`ssh-agent -s`.quiet();
        const output = agentOutput.stdout.toString();
        // Parse SSH_AUTH_SOCK and SSH_AGENT_PID from agent output
        const sockMatch = output.match(/SSH_AUTH_SOCK=([^;]+)/);
        const pidMatch = output.match(/SSH_AGENT_PID=(\d+)/);
        if (sockMatch) process.env.SSH_AUTH_SOCK = sockMatch[1];
        if (pidMatch) process.env.SSH_AGENT_PID = pidMatch[1];
      }

      // Add the key to the agent
      await $`ssh-add ${privateKeyPath}`.quiet();
    } catch (err) {
      console.warn(`Failed to register SSH key with agent: ${err}`);
    }
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
    const skillsDir = join(this.agentHome, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });

    for (const skill of skills) {
      const skillPath = join(skillsDir, `${skill.name}.md`);
      await writeFile(skillPath, skill.content);
    }
  }

  async deployGlobalTemplates(userId: string): Promise<void> {
    const claudeTemplateDir = join(this.templatesRoot, 'claude');
    const claudeDir = join(this.agentHome, '.claude');

    // Deploy CLAUDE.md to agent home root
    try {
      await copyFile(join(claudeTemplateDir, 'CLAUDE.md'), join(this.agentHome, 'CLAUDE.md'));
    } catch {
      // CLAUDE.md template not found, skip
    }

    // Deploy skills to ~/.claude/skills/
    try {
      const skillsSource = join(claudeTemplateDir, 'skills');
      const skillsDest = join(claudeDir, 'skills');
      await readdir(skillsSource);
      await cp(skillsSource, skillsDest, { recursive: true, force: true });
    } catch {
      // Skills directory not found, skip
    }
  }

  async storeHooks(userId: string, sessionId?: string, terminalId?: string, customHooks?: HookConfig): Promise<void> {
    const settingsPath = join(this.agentHome, '.claude', 'settings.json');

    // Build hook commands that read from stdin and pass actual data from Claude CLI.
    // Use $REMOTE_AGENT_SESSION_ID and $REMOTE_AGENT_TERMINAL_ID env vars (set per-terminal
    // in terminals.routes.ts) so hooks always report the correct session, even when
    // multiple Claude instances share the same settings.json.
    const baseUrl = 'http://localhost:5100/internal/hooks';

    // Guard: skip hooks when spawned by the classifier (prevents infinite loop)
    const guard = '[ "$REMOTE_AGENT_CLASSIFIER" = "1" ] && exit 0;';

    const attentionCommand = `${guard} INPUT=$(cat); echo "$INPUT" | jq -c '. + {"sessionId": env.REMOTE_AGENT_SESSION_ID, "terminalId": env.REMOTE_AGENT_TERMINAL_ID}' | curl -s -X POST "${baseUrl}/attention" -H "Content-Type: application/json" -d @- &`;

    const completeCommand = `${guard} INPUT=$(cat); echo "$INPUT" | jq -c '. + {"sessionId": env.REMOTE_AGENT_SESSION_ID, "terminalId": env.REMOTE_AGENT_TERMINAL_ID}' | curl -s -X POST "${baseUrl}/complete" -H "Content-Type: application/json" -d @- &`;

    const defaultHooks: HookConfig = {
      hooks: {
        Notification: [{
          matcher: 'idle_prompt|permission_prompt',
          hooks: [{
            type: 'command',
            command: attentionCommand,
          }],
        }],
        Stop: [{
          hooks: [{
            type: 'command',
            command: completeCommand,
          }],
        }],
        PostToolUse: [{
          matcher: 'mcp__agent-browser__screenshot',
          hooks: [{
            type: 'command',
            command: `${guard} INPUT=$(cat); echo "$INPUT" | jq -c '{sessionId: env.REMOTE_AGENT_SESSION_ID, terminalId: env.REMOTE_AGENT_TERMINAL_ID, tool_name: .tool_name, tool_input: (.tool_input | tostring), tool_result: (if .tool_result.content then (.tool_result.content | if type == "array" then (map(select(.type == "text")) | .[0].text // "") else tostring end) else (.tool_result | tostring) end)}' | curl -s -X POST "${baseUrl}/artifact" -H "Content-Type: application/json" -d @- &`,
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
    const settingsPath = join(this.agentHome, '.claude', 'settings.json');

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
  templatesRoot: process.env.TEMPLATES_ROOT || '/app/templates',
});
