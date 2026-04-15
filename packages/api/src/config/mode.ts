export type AgentMode = 'local' | 'remote';

export function getMode(): AgentMode {
  return (process.env.REMOTE_AGENT_MODE as AgentMode) || 'remote';
}

export function isLocalMode(): boolean {
  return getMode() === 'local';
}

export function isRemoteMode(): boolean {
  return getMode() === 'remote';
}
