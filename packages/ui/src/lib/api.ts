const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Auth
  getMe: () => request<{ user: User | null }>('/auth/me'),
  setPin: (pin: string) => request('/auth/pin/set', { method: 'POST', body: JSON.stringify({ pin }) }),
  verifyPin: (pin: string) => request<{ valid: boolean }>('/auth/pin/verify', { method: 'POST', body: JSON.stringify({ pin }) }),

  // Sessions (container for terminals)
  getSessions: () => request<Session[]>('/sessions'),
  getSession: (id: string) => request<Session>(`/sessions/${id}`),
  createSession: (projectId?: string) => request<Session>('/sessions', { method: 'POST', body: JSON.stringify({ projectId }) }),
  terminateSession: (id: string) => request(`/sessions/${id}`, { method: 'DELETE' }),
  getSessionGitStatus: (sessionId: string) => request<GitStatus>(`/sessions/${sessionId}/git/status`),
  getSessionGitDiff: (sessionId: string, cached = false) =>
    request<{ diff: string }>(`/sessions/${sessionId}/git/diff${cached ? '?cached=true' : ''}`),
  getSessionFileDiff: (sessionId: string, file: string) =>
    request<{ diff: string; file: string }>(`/sessions/${sessionId}/git/diff/${encodeURIComponent(file)}`),

  // Files
  getSessionFiles: (sessionId: string, path = '.') =>
    request<DirectoryListing>(`/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`),
  getSessionFileContent: (sessionId: string, path: string) =>
    request<FileContent>(`/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`),

  // Projects
  getProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: CreateProjectInput) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id: string, pin: string) =>
    request(`/projects/${id}`, { method: 'DELETE', headers: { 'X-Pin': pin } }),
  gitFetch: (projectId: string) => request(`/projects/${projectId}/fetch`, { method: 'POST' }),
  gitPull: (projectId: string, branch?: string) =>
    request(`/projects/${projectId}/pull`, { method: 'POST', body: JSON.stringify({ branch }) }),
  gitPush: (projectId: string, branch?: string) =>
    request(`/projects/${projectId}/push`, { method: 'POST', body: JSON.stringify({ branch }) }),

  // Notifications
  registerFCM: (token: string, deviceName?: string) =>
    request('/notifications/fcm/register', { method: 'POST', body: JSON.stringify({ token, deviceName }) }),
  getDevices: () => request<Device[]>('/notifications/devices'),
  getPreferences: () => request<NotificationPrefs>('/notifications/preferences'),
  updatePreferences: (prefs: Partial<NotificationPrefs>) =>
    request('/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),
  testNotification: () => request<{ success: boolean }>('/notifications/test', { method: 'POST' }),
  getNotifications: (params?: { status?: string; sessionId?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.sessionId) searchParams.set('sessionId', params.sessionId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<{ notifications: NotificationRecord[] }>(`/notifications${query ? `?${query}` : ''}`);
  },
  getUnreadCount: () => request<{ count: number }>('/notifications/unread-count'),
  markNotificationRead: (id: string) =>
    request(`/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'read' }),
    }),
  markNotificationsRead: (ids: string[]) =>
    request('/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  dismissNotifications: (params: { sessionId?: string; terminalId?: string }) =>
    request('/notifications/dismiss', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // Version
  getVersion: (force = false) =>
    request<VersionInfo>(`/version${force ? '?force=true' : ''}`),

  // Workspace
  pairWorkspace: (data: PairWorkspaceInput) =>
    request('/workspace/pair', { method: 'POST', body: JSON.stringify(data) }),
  getSSHKeys: () => request<SSHKey[]>('/workspace/ssh-keys'),
  addSSHKey: (data: { name?: string; privateKey: string; publicKey?: string }) =>
    request('/workspace/ssh-keys', { method: 'POST', body: JSON.stringify(data) }),
  deleteSSHKey: (id: string, pin: string) =>
    request(`/workspace/ssh-keys/${id}`, { method: 'DELETE', headers: { 'X-Pin': pin } }),

  // Terminals
  getSessionTerminals: (sessionId: string) =>
    request<TerminalInfo[]>(`/terminals/session/${sessionId}`),
  getTerminal: (id: string) =>
    request<TerminalInfo>(`/terminals/${id}`),
  createTerminal: (data: CreateTerminalInput) =>
    request<TerminalInfo>('/terminals', { method: 'POST', body: JSON.stringify(data) }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    request(`/terminals/${id}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  closeTerminal: (id: string) =>
    request(`/terminals/${id}`, { method: 'DELETE' }),

  // Review Comments
  getReviewComments: (sessionId: string, status?: ReviewCommentStatus, batchId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (batchId) params.set('batchId', batchId);
    const query = params.toString();
    return request<ReviewComment[]>(`/sessions/${sessionId}/review-comments${query ? '?' + query : ''}`);
  },
  createReviewComment: (sessionId: string, data: CreateReviewCommentInput) =>
    request<ReviewComment>(`/sessions/${sessionId}/review-comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateReviewComment: (sessionId: string, id: string, comment: string) =>
    request<ReviewComment>(`/sessions/${sessionId}/review-comments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ comment }),
    }),
  deleteReviewComment: (sessionId: string, id: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/review-comments/${id}`, {
      method: 'DELETE',
    }),
  proceedReviewComments: (sessionId: string) =>
    request<ProceedResponse>(`/sessions/${sessionId}/review-comments/proceed`, {
      method: 'POST',
    }),
  getReviewBatches: (sessionId: string) =>
    request<ReviewBatch[]>(`/sessions/${sessionId}/review-comments/batches`),
  resolveReviewBatch: (sessionId: string, batchId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/review-comments/batches/${batchId}/resolve`, {
      method: 'POST',
    }),
  rerunReviewBatch: (sessionId: string, batchId: string) =>
    request<{ success: boolean; count: number }>(`/sessions/${sessionId}/review-comments/batches/${batchId}/rerun`, {
      method: 'POST',
    }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  image?: string;
  hasPin: boolean;
}

export interface Session {
  id: string;
  userId: string;
  projectId?: string;
  status: 'active' | 'waiting_input' | 'paused' | 'terminated';
  liveStatus?: string;
  lastMessage?: string;
  createdAt: string;
  lastActiveAt: string;
  project?: Project;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  repoUrl?: string;
  localPath: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  git?: GitStatus;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface Device {
  id: string;
  deviceName?: string;
  platform: 'web' | 'android' | 'ios';
  createdAt: string;
}

export interface NotificationPrefs {
  enabledAdapters: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  notifyOnInput: boolean;
  notifyOnError: boolean;
  notifyOnComplete: boolean;
}

export interface NotificationRecord {
  id: string;
  sessionId: string;
  terminalId?: string | null;
  type: string;
  title: string;
  body: string;
  metadata?: {
    projectName?: string;
    stopReason?: string;
    [key: string]: unknown;
  } | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';
  resolvedAction?: string | null;
  createdAt: string;
}

export interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  createdAt: string;
}


export interface CreateProjectInput {
  name: string;
  description?: string;
  repoUrl?: string;
  branch?: string;
  sshKeyId?: string;
}

export interface PairWorkspaceInput {
  sshPrivateKey?: string;
  sshPublicKey?: string;
  skills?: { name: string; content: string }[];
  hooks?: {
    hooks: Record<string, Array<{
      matcher?: string;
      hooks: Array<{ type: 'command'; command: string; timeout?: number }>;
    }>>;
  };
  claudeSettings?: Record<string, unknown>;
}

export type TerminalType = 'shell' | 'claude';

export interface TerminalInfo {
  id: string;
  sessionId: string;
  name: string;
  type: TerminalType;
  command: string[];
  cols: number;
  rows: number;
  persist: boolean;
  status: 'running' | 'exited';
  liveStatus?: string;
  exitCode?: number;
  scrollback?: string;
  createdAt: string;
}

export interface CreateTerminalInput {
  sessionId: string;
  name?: string;
  type?: TerminalType;
  command?: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
  initialPrompt?: string;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  lastChecked: string | null;
  error?: string;
}

export type LineSide = 'additions' | 'deletions';
export type ReviewCommentStatus = 'pending' | 'running' | 'resolved';

export interface ReviewComment {
  id: string;
  sessionId: string;
  batchId: string | null;
  filePath: string;
  lineNumber: number;
  lineSide: LineSide;
  lineContent: string;
  fileSha: string | null;
  comment: string;
  status: ReviewCommentStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateReviewCommentInput {
  filePath: string;
  lineNumber: number;
  lineSide: LineSide;
  lineContent: string;
  fileSha?: string;
  comment: string;
}

export interface ReviewBatch {
  batchId: string;
  status: ReviewCommentStatus;
  count: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProceedResponse {
  batchId: string;
  message: string;
  commentCount: number;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  name: string;
  content: string;
  size: number;
}
