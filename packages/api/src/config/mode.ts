export type AgentMode = 'local' | 'remote';

export function getMode(): AgentMode {
  // `RA_MODE` is set by the local-mode launcher (electron); `REMOTE_AGENT_MODE`
  // is the legacy name still used by docker-compose and `start:local`.
  return ((process.env.RA_MODE || process.env.REMOTE_AGENT_MODE) as AgentMode) || 'remote';
}

export function isLocalMode(): boolean {
  return getMode() === 'local';
}

export function isRemoteMode(): boolean {
  return getMode() === 'remote';
}
