/**
 * API client for the Remote Agent backend.
 * Mirrors packages/ui/src/lib/api.ts adapted for React Native.
 */
import * as SecureStore from 'expo-secure-store';

const AUTH_COOKIE_KEY = 'auth_session_cookie';

let baseUrl = '';

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '');
}

export function getBaseUrl(): string {
  return baseUrl;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const cookie = await SecureStore.getItemAsync(AUTH_COOKIE_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  return headers;
}

export async function saveAuthCookie(cookie: string) {
  await SecureStore.setItemAsync(AUTH_COOKIE_KEY, cookie);
}

export async function clearAuthCookie() {
  await SecureStore.deleteItemAsync(AUTH_COOKIE_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }

  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const api = {
  getMe: () => request<{ user: import('../types').User | null }>('/auth/me'),

  setPin: (pin: string) =>
    request<{ success: boolean }>('/auth/pin/set', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  verifyPin: (pin: string) =>
    request<{ valid: boolean }>('/auth/pin/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  // ─── Sessions ──────────────────────────────────────────────────────────────

  getSessions: () => request<import('../types').Session[]>('/sessions'),

  getSession: (id: string) =>
    request<import('../types').Session>(`/sessions/${id}`),

  createSession: (projectId?: string) =>
    request<import('../types').Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),

  terminateSession: (id: string) =>
    request<{ success: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),

  getSessionGitStatus: (sessionId: string) =>
    request<import('../types').GitStatus>(`/sessions/${sessionId}/git/status`),

  getSessionGitDiff: (sessionId: string, cached?: boolean) =>
    request<{ diff: string }>(
      `/sessions/${sessionId}/git/diff${cached ? '?cached=true' : ''}`
    ),

  getSessionFileDiff: (sessionId: string, file: string) =>
    request<{ diff: string; file: string }>(
      `/sessions/${sessionId}/git/diff/${encodeURIComponent(file)}`
    ),

  // ─── Files ─────────────────────────────────────────────────────────────────

  getSessionFiles: (sessionId: string, path?: string) =>
    request<{ entries: Array<{ name: string; type: 'file' | 'directory'; size?: number }> }>(
      `/sessions/${sessionId}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`
    ),

  getSessionFileContent: (sessionId: string, path: string) =>
    request<{ content: string; path: string }>(
      `/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`
    ),

  // ─── Projects ──────────────────────────────────────────────────────────────

  getProjects: () => request<import('../types').Project[]>('/projects'),

  getProject: (id: string) =>
    request<import('../types').Project>(`/projects/${id}`),

  createProject: (data: import('../types').CreateProjectInput) =>
    request<import('../types').Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string, pin: string) =>
    request<{ success: boolean }>(`/projects/${id}`, {
      method: 'DELETE',
      headers: { 'X-PIN': pin },
    }),

  gitFetch: (projectId: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/fetch`, {
      method: 'POST',
    }),

  gitPull: (projectId: string, branch?: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/pull`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),

  gitPush: (projectId: string, branch?: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/push`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),

  // ─── Terminals ─────────────────────────────────────────────────────────────

  getSessionTerminals: (sessionId: string) =>
    request<import('../types').TerminalInfo[]>(
      `/terminals/session/${sessionId}`
    ),

  getTerminal: (id: string) =>
    request<import('../types').TerminalInfo>(`/terminals/${id}`),

  createTerminal: (data: import('../types').CreateTerminalInput) =>
    request<import('../types').TerminalInfo>('/terminals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resizeTerminal: (id: string, cols: number, rows: number) =>
    request<{ success: boolean }>(`/terminals/${id}/resize`, {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    }),

  closeTerminal: (id: string) =>
    request<{ success: boolean }>(`/terminals/${id}`, { method: 'DELETE' }),

  // ─── Notifications ─────────────────────────────────────────────────────────

  registerFCM: (token: string, deviceName?: string, platform?: string) =>
    request<{ success: boolean }>('/notifications/fcm/register', {
      method: 'POST',
      body: JSON.stringify({ token, deviceName, platform }),
    }),

  unregisterFCM: (token: string) =>
    request<{ success: boolean }>(`/notifications/fcm/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }),

  getDevices: () => request<import('../types').Device[]>('/notifications/devices'),

  getPreferences: () =>
    request<import('../types').NotificationPrefs>('/notifications/preferences'),

  updatePreferences: (prefs: Partial<import('../types').NotificationPrefs>) =>
    request<{ success: boolean }>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),

  testNotification: () =>
    request<{ success: boolean }>('/notifications/test', { method: 'POST' }),

  getNotifications: (params?: {
    status?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.sessionId) searchParams.set('sessionId', params.sessionId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return request<{ notifications: import('../types').NotificationRecord[] }>(
      `/notifications${qs ? `?${qs}` : ''}`
    );
  },

  getUnreadCount: () =>
    request<{ count: number }>('/notifications/unread-count'),

  markNotificationRead: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'read' }),
    }),

  markNotificationsRead: (ids: string[]) =>
    request<{ success: boolean }>('/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  dismissNotifications: (params: { sessionId?: string; terminalId?: string }) =>
    request<{ success: boolean; count: number }>('/notifications/dismiss', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  respondToNotification: (
    id: string,
    data: { action: string; text?: string }
  ) =>
    request<{ success: boolean }>(`/notifications/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ─── Version ───────────────────────────────────────────────────────────────

  getVersion: (force?: boolean) =>
    request<import('../types').VersionInfo>(
      `/version${force ? '?force=true' : ''}`
    ),

  // ─── Workspace ─────────────────────────────────────────────────────────────

  getSSHKeys: () => request<import('../types').SSHKey[]>('/workspace/ssh-keys'),

  addSSHKey: (data: { name?: string; privateKey: string; publicKey?: string }) =>
    request<{ success: boolean }>('/workspace/ssh-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteSSHKey: (id: string, pin: string) =>
    request<{ success: boolean }>(`/workspace/ssh-keys/${id}`, {
      method: 'DELETE',
      headers: { 'X-PIN': pin },
    }),

  pairWorkspace: (data: Record<string, unknown>) =>
    request<{ success: boolean }>('/workspace/pair', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ─── Review Comments ───────────────────────────────────────────────────────

  getReviewComments: (sessionId: string, status?: string, batchId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (batchId) params.set('batchId', batchId);
    const qs = params.toString();
    return request<import('../types').ReviewComment[]>(
      `/sessions/${sessionId}/review-comments${qs ? `?${qs}` : ''}`
    );
  },

  createReviewComment: (
    sessionId: string,
    data: { file?: string; line?: number; comment: string }
  ) =>
    request<import('../types').ReviewComment>(
      `/sessions/${sessionId}/review-comments`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  proceedReviewComments: (sessionId: string) =>
    request<{ batchId: string; terminalId: string }>(
      `/sessions/${sessionId}/review-comments/proceed`,
      { method: 'POST' }
    ),

  getReviewBatches: (sessionId: string) =>
    request<import('../types').ReviewBatch[]>(
      `/sessions/${sessionId}/review-comments/batches`
    ),
};
