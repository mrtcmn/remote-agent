import { join } from 'node:path';
import { homedir } from 'node:os';
import { isLocalMode } from './mode';

function localBase(): string {
  return join(homedir(), 'remote-agent');
}

export function getWorkspacesRoot(): string {
  if (isLocalMode()) return process.env.WORKSPACES_ROOT || join(localBase(), 'workspaces');
  return process.env.WORKSPACES_ROOT || '/app/workspaces';
}

export function getSSHKeysRoot(): string {
  if (isLocalMode()) return process.env.SSH_KEYS_ROOT || join(localBase(), 'ssh-keys');
  return process.env.SSH_KEYS_ROOT || '/app/ssh-keys';
}

export function getConfigRoot(): string {
  if (isLocalMode()) return process.env.CONFIG_ROOT || join(localBase(), 'config');
  return process.env.CONFIG_ROOT || '/app/config';
}

export function getTemplatesRoot(): string {
  if (isLocalMode()) return process.env.TEMPLATES_ROOT || join(localBase(), 'templates');
  return process.env.TEMPLATES_ROOT || '/app/templates';
}

export function getAgentHome(): string {
  if (isLocalMode()) return homedir();
  return process.env.AGENT_HOME || process.env.HOME || '/home/agent';
}

export function getLocalDbPath(): string {
  return join(localBase(), 'data', 'local.db');
}

export function getDefaultPort(): number {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  if (isLocalMode()) return 13590;
  return 5100;
}
