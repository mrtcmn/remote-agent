import type { Subprocess } from 'bun';

export type CodeEditorStatus = 'starting' | 'running' | 'stopped';

export interface EditorInstance {
  id: string;
  sessionId: string;
  port: number;
  status: CodeEditorStatus;
  process: Subprocess | null;
  projectPath: string;
  createdAt: Date;
}

export interface StartEditorOptions {
  editorId: string;
  sessionId: string;
  projectPath: string;
}
