import { readdir, readFile, symlink, unlink, stat, mkdir, rm } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { getWorkspacesRoot } from '../../config/paths';

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
  return getWorkspacesRoot();
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
   * Search skills using the skills CLI (npx skills find)
   */
  async search(query: string): Promise<RegistrySkill[]> {
    try {
      const results = await this.searchViaCLI(query);
      if (results.length > 0) return results;
    } catch {
      // CLI may not be available
    }

    // Fallback: search well-known skill repos
    return this.searchFallback(query);
  }

  /**
   * Get trending/popular skills.
   * skills.sh has no public API, so we use the well-known skills catalog.
   */
  async getTrending(): Promise<RegistrySkill[]> {
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
      const args = ['npx', '-y', 'skills', 'add', repo, '-y', '-g'];
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
   * Search for skills using the npx skills find CLI
   * Parses output lines like: owner/repo@skill-name  NNK installs
   */
  private async searchViaCLI(query: string): Promise<RegistrySkill[]> {
    if (!query) return []; // Empty query triggers interactive mode
    const args = ['npx', '-y', 'skills', 'find', query];

    const proc = Bun.spawnSync(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, DISABLE_TELEMETRY: '1', NO_COLOR: '1' },
      timeout: 30000,
    });

    const output = proc.stdout.toString();
    if (proc.exitCode !== 0 || !output) return [];

    return this.parseCLIOutput(output);
  }

  /**
   * Parse the skills CLI output into RegistrySkill objects.
   * Each skill appears as two lines:
   *   owner/repo@skill-name  NNK installs
   *   └ https://skills.sh/owner/repo/skill-name
   */
  private parseCLIOutput(output: string): RegistrySkill[] {
    const skills: RegistrySkill[] = [];
    const lines = output.split('\n');

    // Match lines like: owner/repo@skill-name  123K installs
    // ANSI codes may be present, so strip them
    const ansiRegex = /\x1b\[[0-9;]*m/g;

    for (const rawLine of lines) {
      const line = rawLine.replace(ansiRegex, '').trim();

      // Match pattern: owner/repo@skill  NNK installs
      const match = line.match(/^(.+?)@(.+?)\s+([\d.]+[KMB]?)\s*installs?$/i);
      if (!match) continue;

      const repo = match[1].trim();
      const name = match[2].trim();
      const installStr = match[3].trim();

      // Parse install count (e.g., "56.8K" -> 56800)
      let installs = 0;
      const numMatch = installStr.match(/^([\d.]+)([KMB]?)$/i);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const suffix = numMatch[2].toUpperCase();
        if (suffix === 'K') installs = Math.round(num * 1000);
        else if (suffix === 'M') installs = Math.round(num * 1000000);
        else if (suffix === 'B') installs = Math.round(num * 1000000000);
        else installs = Math.round(num);
      }

      skills.push({
        name,
        description: '',  // CLI doesn't provide descriptions
        repo,
        installs,
      });
    }

    return skills;
  }

  /**
   * Find skill directories in a cloned repo
   */
  private async findSkillsInRepo(repoDir: string, filterName?: string): Promise<string[]> {
    const skills: string[] = [];

    // Helper: check if a directory name matches the filter.
    // skills.sh prefixes skill names (e.g., "vercel-react-best-practices" for dir "react-best-practices"),
    // so we also match when filterName ends with the directory name.
    const nameMatches = (dirName: string, filter: string): boolean => {
      if (dirName === filter) return true;
      if (filter.endsWith(dirName) && filter[filter.length - dirName.length - 1] === '-') return true;
      return false;
    };

    // Check for skills/ subdirectory (common layout)
    const skillsSubDir = join(repoDir, 'skills');
    if (existsSync(skillsSubDir)) {
      const entries = await readdir(skillsSubDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (filterName && !nameMatches(entry.name, filterName)) continue;

        const skillMd = join(skillsSubDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          skills.push(join(skillsSubDir, entry.name));
        }
      }
    }

    // Check root level (single-skill repo)
    const rootSkillMd = join(repoDir, 'SKILL.md');
    if (existsSync(rootSkillMd)) {
      if (!filterName || nameMatches(basename(repoDir), filterName)) {
        skills.push(repoDir);
      }
    }

    // Check all top-level dirs for SKILL.md
    if (skills.length === 0) {
      const entries = await readdir(repoDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (filterName && !nameMatches(entry.name, filterName)) continue;

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
      // vercel-labs/skills
      { name: 'find-skills', description: 'Discover and install agent skills', repo: 'vercel-labs/skills', installs: 517000 },
      // vercel-labs/agent-skills
      { name: 'react-best-practices', description: '40+ optimization rules for React/Next.js development', repo: 'vercel-labs/agent-skills', installs: 89000 },
      { name: 'web-design-guidelines', description: '100+ accessibility, performance, and UX rules', repo: 'vercel-labs/agent-skills', installs: 72000 },
      { name: 'react-native-skills', description: 'Mobile development patterns and best practices', repo: 'vercel-labs/agent-skills', installs: 41000 },
      { name: 'composition-patterns', description: 'Scalable component design patterns', repo: 'vercel-labs/agent-skills', installs: 35000 },
      { name: 'deploy-to-vercel', description: 'Direct deployment to Vercel', repo: 'vercel-labs/agent-skills', installs: 28000 },
      // anthropics/skills
      { name: 'pdf', description: 'PDF generation and manipulation', repo: 'anthropics/skills', installs: 52000 },
      { name: 'claude-api', description: 'Build apps with the Claude API', repo: 'anthropics/skills', installs: 48000 },
      { name: 'frontend-design', description: 'Frontend design patterns and best practices', repo: 'anthropics/skills', installs: 44000 },
      { name: 'webapp-testing', description: 'Web application testing strategies', repo: 'anthropics/skills', installs: 38000 },
      { name: 'mcp-builder', description: 'Build Model Context Protocol servers', repo: 'anthropics/skills', installs: 31000 },
      { name: 'docx', description: 'Word document generation', repo: 'anthropics/skills', installs: 29000 },
      { name: 'xlsx', description: 'Excel spreadsheet generation', repo: 'anthropics/skills', installs: 27000 },
      { name: 'pptx', description: 'PowerPoint presentation generation', repo: 'anthropics/skills', installs: 25000 },
      { name: 'skill-creator', description: 'Create new agent skills', repo: 'anthropics/skills', installs: 22000 },
      { name: 'web-artifacts-builder', description: 'Build interactive web artifacts', repo: 'anthropics/skills', installs: 20000 },
    ];
  }
}

export const skillsService = new SkillsService();
