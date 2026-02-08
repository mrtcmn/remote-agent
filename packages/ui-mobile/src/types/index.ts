// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'active'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'terminated';

export interface Session {
  id: string;
  userId: string;
  projectId?: string | null;
  projectName?: string | null;
  status: SessionStatus;
  lastMessage?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Terminals ───────────────────────────────────────────────────────────────

export type TerminalType = 'shell' | 'claude';

export interface TerminalInfo {
  id: string;
  sessionId: string;
  type: TerminalType;
  status: 'running' | 'idle' | 'exited';
  title?: string | null;
  exitCode?: number | null;
  createdAt: string;
}

export interface CreateTerminalInput {
  sessionId: string;
  type: TerminalType;
  prompt?: string;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  userId: string;
  name: string;
  repoUrl?: string | null;
  branch?: string | null;
  sshKeyId?: string | null;
  localPath?: string | null;
  gitStatus?: {
    ahead?: number;
    behind?: number;
    modified?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  repoUrl?: string;
  branch?: string;
  sshKeyId?: string;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'user_input_required'
  | 'permission_request'
  | 'task_complete'
  | 'error'
  | 'session_started'
  | 'session_ended';

export type NotificationStatus =
  | 'pending'
  | 'sent'
  | 'read'
  | 'resolved'
  | 'dismissed';

export type Priority = 'low' | 'normal' | 'high';

export interface NotificationAction {
  label: string;
  action: string;
}

export interface NotificationRecord {
  id: string;
  sessionId: string;
  terminalId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: {
    projectName?: string;
    stopReason?: string;
    notificationId?: string;
    [key: string]: unknown;
  } | null;
  actions?: NotificationAction[] | null;
  priority: Priority;
  status: NotificationStatus;
  resolvedAction?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface NotificationPrefs {
  enabledAdapters: string[];
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  notifyOnInput: boolean;
  notifyOnError: boolean;
  notifyOnComplete: boolean;
}

export interface Device {
  id: string;
  token: string;
  deviceName?: string | null;
  platform: 'web' | 'android' | 'ios';
  createdAt: string;
}

// ─── Git ─────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch?: string;
  ahead?: number;
  behind?: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

// ─── SSH Keys ────────────────────────────────────────────────────────────────

export interface SSHKey {
  id: string;
  name?: string | null;
  publicKey: string;
  createdAt: string;
}

// ─── Version ─────────────────────────────────────────────────────────────────

export interface VersionInfo {
  current: string;
  latest?: string;
  updateAvailable: boolean;
  lastChecked: string;
  changelog?: string;
}

// ─── Review Comments ─────────────────────────────────────────────────────────

export type ReviewCommentStatus = 'pending' | 'running' | 'resolved';

export interface ReviewComment {
  id: string;
  sessionId: string;
  file?: string | null;
  line?: number | null;
  comment: string;
  status: ReviewCommentStatus;
  batchId?: string | null;
  createdAt: string;
}

export interface ReviewBatch {
  id: string;
  sessionId: string;
  status: 'running' | 'resolved';
  commentCount: number;
  createdAt: string;
}
