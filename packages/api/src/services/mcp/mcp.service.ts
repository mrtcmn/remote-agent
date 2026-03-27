import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const MCP_REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpInstalledServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpRegistryServer {
  name: string;
  title?: string;
  description: string;
  registryType?: string;
  packageId?: string;
  version?: string;
  repoUrl?: string;
  envVars?: McpEnvVar[];
  args?: McpArg[];
}

export interface McpEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  placeholder?: string;
}

export interface McpArg {
  name: string;
  description?: string;
  type: string;
  isRequired?: boolean;
  default?: string;
  value?: string;
  valueHint?: string;
}

interface RegistryResponse {
  servers: RegistryServerEntry[];
  metadata: {
    count: number;
    nextCursor?: string;
  };
}

interface RegistryServerEntry {
  server: {
    name: string;
    title?: string;
    description: string;
    version?: string;
    repository?: {
      url?: string;
      source?: string;
    };
    packages?: RegistryPackage[];
    remotes?: unknown[];
  };
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      status: string;
      publishedAt: string;
      isLatest: boolean;
    };
  };
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  transport: { type: string };
  environmentVariables?: RegistryEnvVar[];
  packageArguments?: RegistryArg[];
  runtimeHint?: string;
  runtimeArguments?: RegistryArg[];
}

interface RegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  placeholder?: string;
  format?: string;
}

interface RegistryArg {
  name: string;
  description?: string;
  type: string;
  isRequired?: boolean;
  default?: string;
  value?: string;
  valueHint?: string;
}

// ─── Runtime mapping ─────────────────────────────────────────────────────────

const RUNTIME_MAP: Record<string, { command: string; prefix: string[] }> = {
  npm: { command: 'npx', prefix: ['-y'] },
  pypi: { command: 'uvx', prefix: [] },
};

// ─── Service ─────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT || '/app/workspaces';
}

function getSettingsPath(): string {
  return join(getWorkspaceRoot(), '.claude', 'settings.json');
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(getSettingsPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await writeFile(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function parseRegistryServer(entry: RegistryServerEntry): McpRegistryServer {
  const { server } = entry;
  const pkg = server.packages?.[0];

  const result: McpRegistryServer = {
    name: server.name,
    title: server.title,
    description: server.description,
    repoUrl: server.repository?.url,
  };

  if (pkg) {
    result.registryType = pkg.registryType;
    result.packageId = pkg.identifier;
    result.version = pkg.version;

    if (pkg.environmentVariables?.length) {
      result.envVars = pkg.environmentVariables.map((ev) => ({
        name: ev.name,
        description: ev.description,
        isRequired: ev.isRequired,
        isSecret: ev.isSecret,
        default: ev.default,
        placeholder: ev.placeholder,
      }));
    }

    if (pkg.packageArguments?.length) {
      result.args = pkg.packageArguments.map((a) => ({
        name: a.name,
        description: a.description,
        type: a.type,
        isRequired: a.isRequired,
        default: a.default,
        value: a.value,
        valueHint: a.valueHint,
      }));
    }
  }

  return result;
}

function buildServerConfig(
  server: McpRegistryServer,
  envVars?: Record<string, string>,
  extraArgs?: string[],
): McpServerConfig {
  const runtime = RUNTIME_MAP[server.registryType || ''];

  let command: string;
  let args: string[];

  if (runtime && server.packageId) {
    command = runtime.command;
    args = [...runtime.prefix, server.packageId];
  } else {
    command = server.packageId || server.name;
    args = [];
  }

  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  const config: McpServerConfig = { command, args };

  if (envVars && Object.keys(envVars).length > 0) {
    config.env = envVars;
  }

  return config;
}

class McpService {
  /**
   * Search MCP servers in the registry
   */
  async search(query: string, cursor?: string): Promise<{ servers: McpRegistryServer[]; nextCursor?: string }> {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    params.set('version', 'latest');
    params.set('limit', '30');
    if (cursor) params.set('cursor', cursor);

    const url = `${MCP_REGISTRY_BASE}/servers?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Registry search failed: ${response.status}`);
    }

    const data = (await response.json()) as RegistryResponse;

    return {
      servers: data.servers.map(parseRegistryServer),
      nextCursor: data.metadata.nextCursor,
    };
  }

  /**
   * Get a specific server's details from the registry
   */
  async getServer(serverName: string): Promise<McpRegistryServer | null> {
    const url = `${MCP_REGISTRY_BASE}/servers/${encodeURIComponent(serverName)}/versions/latest`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Registry fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as RegistryServerEntry;
    return parseRegistryServer(data);
  }

  /**
   * List installed MCP servers from settings.json
   */
  async listInstalled(): Promise<McpInstalledServer[]> {
    const settings = await readSettings();
    const mcpServers = (settings.mcpServers || {}) as Record<string, McpServerConfig>;

    return Object.entries(mcpServers).map(([name, config]) => ({
      name,
      command: config.command,
      args: config.args || [],
      env: config.env,
    }));
  }

  /**
   * Install an MCP server by adding it to settings.json
   */
  async install(
    server: McpRegistryServer,
    configName: string,
    envVars?: Record<string, string>,
    extraArgs?: string[],
  ): Promise<{ success: boolean; error?: string }> {
    const config = buildServerConfig(server, envVars, extraArgs);
    const settings = await readSettings();
    const mcpServers = (settings.mcpServers || {}) as Record<string, McpServerConfig>;

    mcpServers[configName] = config;
    settings.mcpServers = mcpServers;

    await writeSettings(settings);
    return { success: true };
  }

  /**
   * Add a custom MCP server manually
   */
  async addCustom(
    name: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<{ success: boolean; error?: string }> {
    const settings = await readSettings();
    const mcpServers = (settings.mcpServers || {}) as Record<string, McpServerConfig>;

    mcpServers[name] = { command, args, env };
    settings.mcpServers = mcpServers;

    await writeSettings(settings);
    return { success: true };
  }

  /**
   * Update an existing MCP server's config
   */
  async update(
    name: string,
    config: Partial<McpServerConfig>,
  ): Promise<{ success: boolean; error?: string }> {
    const settings = await readSettings();
    const mcpServers = (settings.mcpServers || {}) as Record<string, McpServerConfig>;

    if (!mcpServers[name]) {
      return { success: false, error: `Server "${name}" not found` };
    }

    mcpServers[name] = { ...mcpServers[name], ...config };
    settings.mcpServers = mcpServers;

    await writeSettings(settings);
    return { success: true };
  }

  /**
   * Remove an MCP server from settings.json
   */
  async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
    const settings = await readSettings();
    const mcpServers = (settings.mcpServers || {}) as Record<string, McpServerConfig>;

    if (!mcpServers[name]) {
      return { success: false, error: `Server "${name}" not found` };
    }

    delete mcpServers[name];
    settings.mcpServers = mcpServers;

    await writeSettings(settings);
    return { success: true };
  }

  /**
   * Get raw mcpServers config JSON
   */
  async getRawConfig(): Promise<Record<string, McpServerConfig>> {
    const settings = await readSettings();
    return (settings.mcpServers || {}) as Record<string, McpServerConfig>;
  }

  /**
   * Set raw mcpServers config JSON
   */
  async setRawConfig(config: Record<string, McpServerConfig>): Promise<{ success: boolean; error?: string }> {
    const settings = await readSettings();
    settings.mcpServers = config;
    await writeSettings(settings);
    return { success: true };
  }
}

export const mcpService = new McpService();
