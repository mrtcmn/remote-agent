import { readdir, readFile, symlink, unlink, stat, mkdir, rm } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

export interface SkillMeta {
  name: string;
  description: string;
  license?: string;
  mode?: boolean;
  allowedTools?: string[];
  compatibility?: string;
  metadata?: Record<string, unknown>;
}

export interface InstalledSkill extends SkillMeta {
  path: string;
  isSymlink: boolean;
  installedAt: string;
  source?: string;
}

export interface RegistrySkill {
  name: string;
  description: string;
  repo: string;
  installs: number;
  trending?: number;
}

// Agent skill directories (where skills get installed)
const SKILL_DIRS = [
  '.claude/skills',
  '.cursor/skills',
  '.github-copilot/skills',
  '.cline/skills',
];

// Primary install location (Claude Code)
const PRIMARY_SKILL_DIR = '.claude/skills';

// Shared skills cache (source of truth for symlinks)
const SHARED_SKILLS_DIR = '.skills-cache';

function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT || '/app/workspaces';
}

function getSkillsCacheDir(): string {
  return join(getWorkspaceRoot(), SHARED_SKILLS_DIR);
}

function parseSkillMd(content: string): SkillMeta {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { name: 'unknown', description: '' };
  }

  const frontmatter = frontmatterMatch[1];
  const meta: Record<string, unknown> = {};

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    let value: string | unknown = line.substring(colonIdx + 1).trim();

    // Handle arrays (simple inline YAML)
    if (typeof value === 'string' && value.startsWith('[')) {
      try {
        value = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        // keep as string
      }
    }

    // Handle booleans
    if (value === 'true') value = true;
    if (value === 'false') value = false;

    meta[key] = value;
  }

  return {
    name: (meta.name as string) || 'unknown',
    description: (meta.description as string) || '',
    license: meta.license as string | undefined,
    mode: meta.mode as boolean | undefined,
    allowedTools: meta['allowed-tools'] as string[] | undefined,
    compatibility: meta.compatibility as string | undefined,
  };
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

class SkillsService {
  /**
   * List all installed skills across all agent directories
   */
  async listInstalled(): Promise<InstalledSkill[]> {
    const workspaceRoot = getWorkspaceRoot();
    const skills: InstalledSkill[] = [];
    const seen = new Set<string>();

    for (const skillDir of SKILL_DIRS) {
      const fullDir = join(workspaceRoot, skillDir);
      if (!existsSync(fullDir)) continue;

      try {
        const entries = await readdir(fullDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          if (seen.has(entry.name)) continue;

          const skillPath = join(fullDir, entry.name);
          const skillMdPath = join(skillPath, 'SKILL.md');

          try {
            const content = await readFile(skillMdPath, 'utf-8');
            const meta = parseSkillMd(content);
            const stats = await stat(skillPath);
            const linkStat = await stat(skillPath).catch(() => null);
            const isLink = entry.isSymbolicLink();

            seen.add(entry.name);
            skills.push({
              ...meta,
              name: meta.name !== 'unknown' ? meta.name : entry.name,
              path: skillPath,
              isSymlink: isLink,
              installedAt: stats.mtime.toISOString(),
              source: skillDir,
            });
          } catch {
            // No SKILL.md or can't read - still list it
            seen.add(entry.name);
            skills.push({
              name: entry.name,
              description: 'No SKILL.md found',
              path: skillPath,
              isSymlink: entry.isSymbolicLink(),
              installedAt: new Date().toISOString(),
              source: skillDir,
            });
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    }

    return skills;
  }

  /**
   * Install a skill from a git repo using symlink strategy:
   * 1. Clone/download into shared cache
   * 2. Symlink from each agent skill directory to the cache
   */
  async install(repo: string, skillName?: string): Promise<{ success: boolean; installed: string[]; error?: string }> {
    const cacheDir = getSkillsCacheDir();
    await ensureDir(cacheDir);

    // Normalize repo format: owner/repo or full URL
    let repoUrl = repo;
    if (!repo.startsWith('http') && !repo.startsWith('git@')) {
      repoUrl = `https://github.com/${repo}.git`;
    }

    const repoName = basename(repo).replace('.git', '');
    const cloneDir = join(cacheDir, repoName);

    try {
      // Clone or update repo in cache
      if (existsSync(cloneDir)) {
        // Pull latest
        const pull = Bun.spawnSync(['git', '-C', cloneDir, 'pull', '--ff-only'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (pull.exitCode !== 0) {
          // If pull fails, remove and re-clone
          await rm(cloneDir, { recursive: true, force: true });
          const clone = Bun.spawnSync(['git', 'clone', '--depth', '1', repoUrl, cloneDir], {
            stdout: 'pipe',
            stderr: 'pipe',
          });
          if (clone.exitCode !== 0) {
            return { success: false, installed: [], error: `Failed to clone: ${clone.stderr.toString()}` };
          }
        }
      } else {
        const clone = Bun.spawnSync(['git', 'clone', '--depth', '1', repoUrl, cloneDir], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (clone.exitCode !== 0) {
          return { success: false, installed: [], error: `Failed to clone: ${clone.stderr.toString()}` };
        }
      }

      // Find skills in the cloned repo
      const skillDirs = await this.findSkillsInRepo(cloneDir, skillName);
      if (skillDirs.length === 0) {
        return { success: false, installed: [], error: skillName ? `Skill "${skillName}" not found in repo` : 'No skills found in repo' };
      }

      const installed: string[] = [];

      // Create symlinks in each agent skill directory
      for (const skillSrc of skillDirs) {
        const sName = basename(skillSrc);

        for (const agentDir of SKILL_DIRS) {
          const workspaceRoot = getWorkspaceRoot();
          const targetDir = join(workspaceRoot, agentDir);
          await ensureDir(targetDir);

          const linkPath = join(targetDir, sName);

          // Remove existing link/directory
          try {
            const existing = await stat(linkPath).catch(() => null);
            if (existing) {
              await rm(linkPath, { recursive: true, force: true });
            }
            // Also try unlinking in case it's a broken symlink
            await unlink(linkPath).catch(() => {});
          } catch {
            // doesn't exist, fine
          }

          // Create symlink
          try {
            await symlink(skillSrc, linkPath, 'dir');
          } catch (e) {
            console.error(`Failed to symlink ${skillSrc} -> ${linkPath}:`, e);
          }
        }

        installed.push(sName);
      }

      return { success: true, installed };
    } catch (error) {
      return {
        success: false,
        installed: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Uninstall a skill: remove symlinks from all agent dirs + cache
   */
  async uninstall(skillName: string): Promise<{ success: boolean; error?: string }> {
    const workspaceRoot = getWorkspaceRoot();
    let removed = false;

    // Remove symlinks from all agent dirs
    for (const agentDir of SKILL_DIRS) {
      const linkPath = join(workspaceRoot, agentDir, skillName);
      try {
        await rm(linkPath, { recursive: true, force: true });
        removed = true;
      } catch {
        // May not exist in all dirs
      }
      // Also try unlink for symlinks
      try {
        await unlink(linkPath);
        removed = true;
      } catch {
        // ignore
      }
    }

    // Remove from cache
    const cacheDir = getSkillsCacheDir();
    try {
      const cacheDirs = await readdir(cacheDir);
      for (const repoDir of cacheDirs) {
        const skillPath = join(cacheDir, repoDir, 'skills', skillName);
        if (existsSync(skillPath)) {
          await rm(skillPath, { recursive: true, force: true });
          removed = true;
        }
        // Also check root-level skill
        const rootSkillPath = join(cacheDir, repoDir, skillName);
        if (existsSync(rootSkillPath)) {
          await rm(rootSkillPath, { recursive: true, force: true });
          removed = true;
        }
      }
    } catch {
      // No cache dir
    }

    if (!removed) {
      return { success: false, error: `Skill "${skillName}" not found` };
    }

    return { success: true };
  }

  /**
   * Search the skills.sh registry
   */
  async search(query: string): Promise<RegistrySkill[]> {
    try {
      // Try the skills.sh API
      const response = await fetch(`https://skills.sh/api/skills?q=${encodeURIComponent(query)}&limit=30`);
      if (response.ok) {
        const data = await response.json() as { skills?: RegistrySkill[] };
        if (data.skills) return data.skills;
      }
    } catch {
      // API may not be available
    }

    // Fallback: search well-known skill repos
    return this.searchFallback(query);
  }

  /**
   * Get trending/popular skills from registry
   */
  async getTrending(): Promise<RegistrySkill[]> {
    try {
      const response = await fetch('https://skills.sh/api/skills?sort=trending&limit=30');
      if (response.ok) {
        const data = await response.json() as { skills?: RegistrySkill[] };
        if (data.skills) return data.skills;
      }
    } catch {
      // API may not be available
    }

    // Return well-known skills as fallback
    return this.getWellKnownSkills();
  }

  /**
   * Install a skill using npx skills add (if available), with -y flag
   */
  async installViaCLI(repo: string, skillName?: string): Promise<{ success: boolean; output: string; error?: string }> {
    // Check if npx is available
    const npxCheck = Bun.spawnSync(['which', 'npx'], { stdout: 'pipe', stderr: 'pipe' });
    const useNpx = npxCheck.exitCode === 0;

    if (useNpx) {
      const args = ['npx', '-y', 'skills', 'add', repo];
      if (skillName) {
        args.push('--skill', skillName);
      }

      const proc = Bun.spawnSync(args, {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, DISABLE_TELEMETRY: '1' },
        timeout: 60000,
      });

      const stdout = proc.stdout.toString();
      const stderr = proc.stderr.toString();

      if (proc.exitCode === 0) {
        return { success: true, output: stdout };
      }

      // Fall back to manual install
      console.log('npx skills failed, falling back to manual install:', stderr);
    }

    // Manual install via git clone + symlinks
    const result = await this.install(repo, skillName);
    return {
      success: result.success,
      output: result.installed.join(', '),
      error: result.error,
    };
  }

  /**
   * Find skill directories in a cloned repo
   */
  private async findSkillsInRepo(repoDir: string, filterName?: string): Promise<string[]> {
    const skills: string[] = [];

    // Check for skills/ subdirectory (common layout)
    const skillsSubDir = join(repoDir, 'skills');
    if (existsSync(skillsSubDir)) {
      const entries = await readdir(skillsSubDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (filterName && entry.name !== filterName) continue;

        const skillMd = join(skillsSubDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          skills.push(join(skillsSubDir, entry.name));
        }
      }
    }

    // Check root level (single-skill repo)
    const rootSkillMd = join(repoDir, 'SKILL.md');
    if (existsSync(rootSkillMd)) {
      if (!filterName || basename(repoDir) === filterName) {
        skills.push(repoDir);
      }
    }

    // Check all top-level dirs for SKILL.md
    if (skills.length === 0) {
      const entries = await readdir(repoDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (filterName && entry.name !== filterName) continue;

        const skillMd = join(repoDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          skills.push(join(repoDir, entry.name));
        }
      }
    }

    return skills;
  }

  private searchFallback(query: string): RegistrySkill[] {
    const known = this.getWellKnownSkills();
    const q = query.toLowerCase();
    return known.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }

  private getWellKnownSkills(): RegistrySkill[] {
    return [
      { name: 'find-skills', description: 'Discover and install agent skills', repo: 'vercel-labs/skills', installs: 517000 },
      { name: 'react-best-practices', description: '40+ optimization rules for React/Next.js development', repo: 'vercel-labs/agent-skills', installs: 89000 },
      { name: 'web-design-guidelines', description: '100+ accessibility, performance, and UX rules', repo: 'vercel-labs/agent-skills', installs: 72000 },
      { name: 'react-native-guidelines', description: 'Mobile development patterns and best practices', repo: 'vercel-labs/agent-skills', installs: 41000 },
      { name: 'composition-patterns', description: 'Scalable component design patterns', repo: 'vercel-labs/agent-skills', installs: 35000 },
      { name: 'vercel-deploy-claimable', description: 'Direct deployment to Vercel', repo: 'vercel-labs/agent-skills', installs: 28000 },
      { name: 'cursor-rules', description: 'Best practices for Cursor AI coding', repo: 'pontusab/cursor.directory', installs: 65000 },
      { name: 'typescript-strict', description: 'Strict TypeScript coding guidelines', repo: 'anthropics/skills', installs: 52000 },
      { name: 'testing-best-practices', description: 'Testing patterns and strategies', repo: 'anthropics/skills', installs: 44000 },
      { name: 'git-workflow', description: 'Git workflow automation and best practices', repo: 'anthropics/skills', installs: 38000 },
      { name: 'docker-compose', description: 'Docker Compose configuration patterns', repo: 'anthropics/skills', installs: 31000 },
      { name: 'api-design', description: 'RESTful API design guidelines', repo: 'anthropics/skills', installs: 29000 },
      { name: 'security-audit', description: 'Security best practices and vulnerability detection', repo: 'anthropics/skills', installs: 27000 },
      { name: 'performance-optimization', description: 'Code performance optimization patterns', repo: 'anthropics/skills', installs: 25000 },
      { name: 'database-patterns', description: 'Database design and query optimization', repo: 'anthropics/skills', installs: 22000 },
      { name: 'ci-cd-pipelines', description: 'CI/CD pipeline configuration and optimization', repo: 'anthropics/skills', installs: 20000 },
    ];
  }
}

export const skillsService = new SkillsService();
