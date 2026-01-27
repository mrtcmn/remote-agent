import type { Subprocess, Terminal as BunTerminal } from 'bun';

export type TerminalStatus = 'running' | 'exited';

export interface TerminalInstance {
  id: string;
  sessionId: string;
  name: string;
  command: string[];
  cols: number;
  rows: number;
  persist: boolean;
  status: TerminalStatus;
  exitCode: number | null;
  process: Subprocess | null;
  terminal: BunTerminal | null;
  scrollback: string[];
  createdAt: Date;
}

export interface CreateTerminalOptions {
  terminalId: string;
  sessionId: string;
  name?: string;
  command: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalOutput {
  terminalId: string;
  data: Uint8Array;
  timestamp: Date;
}
