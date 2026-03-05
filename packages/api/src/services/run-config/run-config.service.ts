import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq, and, isNull } from 'drizzle-orm';
import { db, runConfigs, runConfigInstances, projects, terminals } from '../../db';
import { terminalService } from '../terminal';
import { spawnAdapterRegistry } from '../spawn-adapter';
import type { NewRunConfig } from '../../db/schema';
import { resolveProjectEnv } from '../workspace/env.service';

export class RunConfigService extends EventEmitter {
  private autoRestartTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    super();
    // Listen for terminal exit events to handle auto-restart
    terminalService.on('exit', (terminalId: string, info: { exitCode: number }) => {
      this.handleTerminalExit(terminalId, info.exitCode);
    });
  }

  async create(data: {
    projectId: string;
    userId: string;
    name: string;
    adapterType: 'npm_script' | 'custom_command' | 'browser_preview';
    command: Record<string, unknown>;
    cwd?: string;
    env?: Record<string, string>;
    autoRestart?: boolean;
  }) {
    const id = nanoid();
    const values: NewRunConfig = {
      id,
      projectId: data.projectId,
      userId: data.userId,
      name: data.name,
      adapterType: data.adapterType,
      command: JSON.stringify(data.command),
      cwd: data.cwd || null,
      env: data.env ? JSON.stringify(data.env) : null,
      autoRestart: data.autoRestart ?? false,
    };

    await db.insert(runConfigs).values(values);

    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, id),
    });

    this.emit('created', config);
    return config!;
  }

  async list(projectId: string) {
    const configs = await db.query.runConfigs.findMany({
      where: eq(runConfigs.projectId, projectId),
      with: { instances: true },
    });

    // Enrich with running status
    return configs.map((config) => {
      const runningInstances = (config.instances || []).filter(
        (inst) => !inst.stoppedAt
      );
      // Check if the terminal is actually running in memory
      const activeInstances = runningInstances.filter((inst) => {
        if (!inst.terminalId) return false;
        const terminal = terminalService.getTerminal(inst.terminalId);
        return terminal?.status === 'running';
      });

      return {
        ...config,
        command: JSON.parse(config.command),
        env: config.env ? JSON.parse(config.env) : null,
        isRunning: activeInstances.length > 0,
        activeTerminalId: activeInstances[0]?.terminalId || null,
      };
    });
  }

  async get(id: string) {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, id),
      with: { instances: true },
    });
    if (!config) return null;

    const runningInstances = (config.instances || []).filter(
      (inst) => !inst.stoppedAt
    );
    const activeInstances = runningInstances.filter((inst) => {
      if (!inst.terminalId) return false;
      const terminal = terminalService.getTerminal(inst.terminalId);
      return terminal?.status === 'running';
    });

    return {
      ...config,
      command: JSON.parse(config.command),
      env: config.env ? JSON.parse(config.env) : null,
      isRunning: activeInstances.length > 0,
      activeTerminalId: activeInstances[0]?.terminalId || null,
    };
  }

  async update(id: string, data: Partial<{
    name: string;
    adapterType: 'npm_script' | 'custom_command' | 'browser_preview';
    command: Record<string, unknown>;
    cwd: string | null;
    env: Record<string, string> | null;
    autoRestart: boolean;
    position: number;
  }>) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.adapterType !== undefined) updateData.adapterType = data.adapterType;
    if (data.command !== undefined) updateData.command = JSON.stringify(data.command);
    if (data.cwd !== undefined) updateData.cwd = data.cwd;
    if (data.env !== undefined) updateData.env = data.env ? JSON.stringify(data.env) : null;
    if (data.autoRestart !== undefined) updateData.autoRestart = data.autoRestart;
    if (data.position !== undefined) updateData.position = data.position;

    await db.update(runConfigs).set(updateData).where(eq(runConfigs.id, id));
    return this.get(id);
  }

  async delete(id: string) {
    // Stop running instances first
    await this.stop(id);
    await db.delete(runConfigs).where(eq(runConfigs.id, id));
    this.emit('deleted', id);
  }

  async start(runConfigId: string, sessionId: string) {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, runConfigId),
      with: { project: true },
    });

    if (!config) {
      throw new Error('Run config not found');
    }

    const adapter = spawnAdapterRegistry.get(config.adapterType);
    if (!adapter) {
      throw new Error(`No adapter found for type: ${config.adapterType}`);
    }

    const commandConfig = JSON.parse(config.command);
    const projectPath = config.project?.localPath || process.cwd();
    const resolved = adapter.resolveCommand(commandConfig, projectPath);

    const terminalId = nanoid();
    const cwd = config.cwd || resolved.cwd || projectPath;
    const projectEnv = await resolveProjectEnv(config.projectId);
    const env: Record<string, string> = {
      HOME: '/home/agent',
      ...projectEnv,
      ...resolved.env,
      ...(config.env ? JSON.parse(config.env) : {}),
    };

    const terminal = await terminalService.createTerminal({
      terminalId,
      sessionId,
      name: config.name,
      type: 'process',
      command: resolved.command,
      cwd,
      env,
    });

    // Create instance record
    const instanceId = nanoid();
    await db.insert(runConfigInstances).values({
      id: instanceId,
      runConfigId,
      terminalId: terminal.id,
    });

    this.emit('started', { runConfigId, terminalId: terminal.id, instanceId });

    return {
      instanceId,
      terminalId: terminal.id,
    };
  }

  async stop(runConfigId: string) {
    // Find running instances (no stoppedAt)
    const instances = await db.query.runConfigInstances.findMany({
      where: and(
        eq(runConfigInstances.runConfigId, runConfigId),
        isNull(runConfigInstances.stoppedAt),
      ),
    });

    // Cancel any auto-restart timers
    const timer = this.autoRestartTimers.get(runConfigId);
    if (timer) {
      clearTimeout(timer);
      this.autoRestartTimers.delete(runConfigId);
    }

    for (const instance of instances) {
      if (instance.terminalId) {
        try {
          await terminalService.closeTerminal(instance.terminalId);
        } catch {
          // Terminal may already be exited
        }
      }

      await db.update(runConfigInstances)
        .set({ stoppedAt: new Date() })
        .where(eq(runConfigInstances.id, instance.id));
    }

    this.emit('stopped', { runConfigId });
  }

  async restart(runConfigId: string, sessionId: string) {
    await this.stop(runConfigId);
    return this.start(runConfigId, sessionId);
  }

  private async handleTerminalExit(terminalId: string, exitCode: number) {
    // Find the instance for this terminal
    const instance = await db.query.runConfigInstances.findFirst({
      where: and(
        eq(runConfigInstances.terminalId, terminalId),
        isNull(runConfigInstances.stoppedAt),
      ),
      with: { runConfig: true },
    });

    if (!instance) return;

    // Mark instance as stopped
    await db.update(runConfigInstances)
      .set({ stoppedAt: new Date() })
      .where(eq(runConfigInstances.id, instance.id));

    // Check if auto-restart is enabled
    if (instance.runConfig?.autoRestart) {
      console.log(`[RunConfigService] Auto-restarting ${instance.runConfig.name} in 1s...`);

      // Find the session for this terminal from the DB
      const terminalRecord = await db.query.terminals.findFirst({
        where: eq(terminals.id, terminalId),
      });

      if (terminalRecord) {
        const timer = setTimeout(async () => {
          try {
            this.autoRestartTimers.delete(instance.runConfigId);
            await this.start(instance.runConfigId, terminalRecord.sessionId);
            console.log(`[RunConfigService] Auto-restarted ${instance.runConfig!.name}`);
          } catch (error) {
            console.error(`[RunConfigService] Auto-restart failed for ${instance.runConfig!.name}:`, error);
          }
        }, 1000);

        this.autoRestartTimers.set(instance.runConfigId, timer);
      }
    }
  }
}

export const runConfigService = new RunConfigService();
