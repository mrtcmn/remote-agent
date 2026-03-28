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
  setPin: (data: { pin: string; password: string }) => request('/auth/pin/set', { method: 'POST', body: JSON.stringify(data) }),
  changePassword: (data: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),
  verifyPin: (pin: string) => request<{ valid: boolean }>('/auth/pin/verify', { method: 'POST', body: JSON.stringify({ pin }) }),

  // Sessions (container for terminals)
  getSessions: () => request<Session[]>('/sessions'),
  getSession: (id: string) => request<Session>(`/sessions/${id}`),
  createSession: (projectId?: string) => request<Session>('/sessions', { method: 'POST', body: JSON.stringify({ projectId }) }),
  terminateSession: (id: string) => request(`/sessions/${id}`, { method: 'DELETE' }),
  getSessionGitStatus: (sessionId: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<GitStatus>(`/sessions/${sessionId}/git/status${query ? `?${query}` : ''}`);
  },
  getSessionGitDiff: (sessionId: string, cached = false, projectId?: string) => {
    const params = new URLSearchParams();
    if (cached) params.set('cached', 'true');
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<{ diff: string }>(`/sessions/${sessionId}/git/diff${query ? `?${query}` : ''}`);
  },
  getSessionFileDiff: (sessionId: string, file: string, projectId?: string) => {
    const params = new URLSearchParams({ file });
    if (projectId) params.set('projectId', projectId);
    return request<{ diff: string; file: string }>(`/sessions/${sessionId}/git/file-diff?${params.toString()}`);
  },

  // Git operations (session-level)
  gitStage: (sessionId: string, files: string[], projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/stage`, {
      method: 'POST',
      body: JSON.stringify({ files, projectId }),
    }),
  gitUnstage: (sessionId: string, files: string[], projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/unstage`, {
      method: 'POST',
      body: JSON.stringify({ files, projectId }),
    }),
  gitCommit: (sessionId: string, message: string, projectId?: string) =>
    request<{ success: boolean; hash: string }>(`/sessions/${sessionId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message, projectId }),
    }),
  gitCheckout: (sessionId: string, branch: string, create?: boolean, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch, create, projectId }),
    }),
  gitSessionPull: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/pull`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  gitSessionPush: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/push`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  gitSessionFetch: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/fetch`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getSessionGitLog: (sessionId: string, limit?: number, projectId?: string) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<{ commits: GitLogEntry[] }>(`/sessions/${sessionId}/git/log${query ? `?${query}` : ''}`);
  },
  getSessionGitBranches: (sessionId: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<GitBranches>(`/sessions/${sessionId}/git/branches${query ? `?${query}` : ''}`);
  },

  // Files
  getSessionFiles: (sessionId: string, path = '.') =>
    request<DirectoryListing>(`/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`),
  getSessionFileContent: (sessionId: string, path: string) =>
    request<FileContent>(`/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`),
  uploadFiles: async (sessionId: string, files: File[], directory = '.') => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('directory', directory);

    const response = await fetch(`${API_BASE}/sessions/${sessionId}/files/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json() as Promise<{ success: boolean; uploaded: string[] }>;
  },
  deleteFile: (sessionId: string, path: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    }),
  copyFile: (sessionId: string, source: string, destination: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/files/copy`, {
      method: 'POST',
      body: JSON.stringify({ source, destination }),
    }),
  moveFile: (sessionId: string, source: string, destination: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/files/move`, {
      method: 'POST',
      body: JSON.stringify({ source, destination }),
    }),

  // Projects
  getProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: CreateProjectInput) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id: string, pin: string) =>
    request(`/projects/${id}`, { method: 'DELETE', headers: { 'X-Pin': pin } }),
  getProjectEnv: (projectId: string) =>
    request<{ env: Record<string, string> }>(`/projects/${projectId}/env`),
  updateProjectEnv: (projectId: string, env: Record<string, string>) =>
    request<{ success: boolean }>(`/projects/${projectId}/env`, {
      method: 'PUT',
      body: JSON.stringify({ env }),
    }),
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
  respondToNotification: (id: string, action: string, text?: string) =>
    request<{ success: boolean }>(`/notifications/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, ...(text ? { text } : {}) }),
    }),

  // Presence
  sendHeartbeat: (terminalId?: string) =>
    request('/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ terminalId }),
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
  removeExitedTerminals: (sessionId: string) =>
    request<{ success: boolean; removed: number }>(`/terminals/session/${sessionId}/exited`, { method: 'DELETE' }),

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

  // ─── Kanban ──────────────────────────────────────────────────────────────

  // Board
  getKanbanBoard: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<KanbanBoardData>(`/kanban/board${query ? `?${query}` : ''}`);
  },
  getKanbanStatuses: () => request<{ id: string; title: string }[]>('/kanban/statuses'),

  // Tasks
  getKanbanTasks: (filters?: TaskFiltersInput) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) params.set(key, value);
      });
    }
    const query = params.toString();
    return request<KanbanTask[]>(`/kanban/tasks${query ? `?${query}` : ''}`);
  },
  getKanbanTask: (id: string) => request<KanbanTask>(`/kanban/tasks/${id}`),
  createKanbanTask: (data: CreateTaskInput) =>
    request<KanbanTask>('/kanban/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateKanbanTask: (id: string, data: UpdateTaskInput) =>
    request<KanbanTask>(`/kanban/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  moveKanbanTask: (id: string, status: KanbanStatus, position: number) =>
    request<KanbanTask>(`/kanban/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ status, position }),
    }),
  deleteKanbanTask: (id: string) =>
    request<{ success: boolean }>(`/kanban/tasks/${id}`, { method: 'DELETE' }),

  // Dependencies
  addTaskDependency: (taskId: string, dependsOnTaskId: string) =>
    request<TaskDependency>(`/kanban/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId }),
    }),
  removeTaskDependency: (id: string) =>
    request<{ success: boolean }>(`/kanban/dependencies/${id}`, { method: 'DELETE' }),

  // Comments
  getTaskComments: (taskId: string) => request<TaskComment[]>(`/kanban/tasks/${taskId}/comments`),
  addTaskComment: (taskId: string, content: string, parentCommentId?: string) =>
    request<TaskComment>(`/kanban/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentCommentId }),
    }),
  resolveTaskComment: (commentId: string) =>
    request<TaskComment>(`/kanban/comments/${commentId}/resolve`, { method: 'POST' }),
  rejectTaskComment: (commentId: string) =>
    request<TaskComment>(`/kanban/comments/${commentId}/reject`, { method: 'POST' }),
  reopenTaskComment: (commentId: string) =>
    request<TaskComment>(`/kanban/comments/${commentId}/reopen`, { method: 'POST' }),
  deleteTaskComment: (commentId: string) =>
    request<{ success: boolean }>(`/kanban/comments/${commentId}`, { method: 'DELETE' }),

  // Attachments
  uploadTaskAttachment: async (taskId: string, file: File, commentId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (commentId) formData.append('commentId', commentId);

    const response = await fetch(`${API_BASE}/kanban/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json() as Promise<TaskAttachment>;
  },
  deleteTaskAttachment: (id: string) =>
    request<{ success: boolean }>(`/kanban/attachments/${id}`, { method: 'DELETE' }),
  getAttachmentUrl: (id: string) => `${API_BASE}/kanban/attachments/${id}/file`,

  // Auto-Flows
  getAutoFlows: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<AutoFlow[]>(`/kanban/flows${query ? `?${query}` : ''}`);
  },
  getAutoFlow: (id: string) => request<AutoFlow>(`/kanban/flows/${id}`),
  createAutoFlow: (data: {
    projectId: string;
    name: string;
    description?: string;
    triggerType?: string;
    cronExpression?: string;
    adapterType?: string;
    adapterConfig?: Record<string, any>;
    taskIds?: string[];
  }) => request<AutoFlow>('/kanban/flows', { method: 'POST', body: JSON.stringify(data) }),
  updateAutoFlow: (id: string, data: Record<string, any>) =>
    request<AutoFlow>(`/kanban/flows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAutoFlow: (id: string) =>
    request<{ success: boolean }>(`/kanban/flows/${id}`, { method: 'DELETE' }),

  // CLI Adapters
  getCLIAdapters: () => request<CLIAdapterInfo[]>('/kanban/adapters'),

  // Settings
  getOrigins: () => request<{ origins: string[] }>('/settings/origins'),
  updateOrigins: (origins: string[]) =>
    request<{ origins: string[] }>('/settings/origins', {
      method: 'PUT',
      body: JSON.stringify({ origins }),
    }),

  // ─── Run Configs ──────────────────────────────────────────────────────────

  getRunConfigs: (projectId: string) =>
    request<RunConfig[]>(`/run-configs/project/${projectId}`),
  discoverScripts: (projectId: string) =>
    request<{ scripts: PackageJsonScript[] }>(`/run-configs/project/${projectId}/scripts`),
  createRunConfig: (data: CreateRunConfigInput) =>
    request<RunConfig>('/run-configs', { method: 'POST', body: JSON.stringify(data) }),
  updateRunConfig: (id: string, data: UpdateRunConfigInput) =>
    request<RunConfig>(`/run-configs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRunConfig: (id: string) =>
    request<{ success: boolean }>(`/run-configs/${id}`, { method: 'DELETE' }),
  startRunConfig: (id: string, sessionId: string) =>
    request<{ success: boolean; instanceId: string; terminalId: string }>(
      `/run-configs/${id}/start`,
      { method: 'POST', body: JSON.stringify({ sessionId }) },
    ),
  stopRunConfig: (id: string) =>
    request<{ success: boolean }>(`/run-configs/${id}/stop`, { method: 'POST' }),
  restartRunConfig: (id: string, sessionId: string) =>
    request<{ success: boolean; instanceId: string; terminalId: string }>(
      `/run-configs/${id}/restart`,
      { method: 'POST', body: JSON.stringify({ sessionId }) },
    ),

  // ─── Browser Preview ────────────────────────────────────────────────────────

  startPreview: (url: string, sessionId: string, viewport?: ViewportPreset) =>
    request<{ previewId: string; viewport: ViewportPreset; url: string; status: string }>(
      '/preview/start',
      { method: 'POST', body: JSON.stringify({ url, sessionId, viewport }) },
    ),
  stopPreview: (id: string) =>
    request<{ success: boolean }>(`/preview/${id}/stop`, { method: 'POST' }),
  getActivePreviews: () =>
    request<{ previews: BrowserPreview[] }>('/preview/active'),

  // ─── Code Editor ──────────────────────────────────────────────────────────

  openEditor: (folder: string) =>
    request<{ url: string; status: string }>('/editor/open', {
      method: 'POST',
      body: JSON.stringify({ folder }),
    }),
  editorStatus: () =>
    request<{ status: string; configured: boolean }>('/editor/status'),
  editorHeartbeat: () =>
    request<{ status: string }>('/editor/heartbeat', { method: 'POST' }),

  // ─── Sidebar ──────────────────────────────────────────────────────────────

  getSidebarData: () => request<SidebarData>('/sessions/sidebar'),
  reorderProjects: (projectIds: string[]) =>
    request<{ success: boolean }>('/projects/reorder', { method: 'PUT', body: JSON.stringify({ projectIds }) }),

  // ─── Multi-Project ────────────────────────────────────────────────────────

  createMultiProject: (data: CreateMultiProjectInput) =>
    request<Project>('/projects/multi', { method: 'POST', body: JSON.stringify(data) }),
  getProjectLinks: (projectId: string) =>
    request<ProjectLink[]>(`/projects/${projectId}/links`),
  addProjectLink: (projectId: string, data: { projectId: string; alias: string }) =>
    request<ProjectLink>(`/projects/${projectId}/links`, { method: 'POST', body: JSON.stringify(data) }),
  removeProjectLink: (projectId: string, linkId: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/links/${linkId}`, { method: 'DELETE' }),

  // ─── Docker ──────────────────────────────────────────────────────────────

  getDockerContainers: () =>
    request<{ containers: DockerContainer[] }>('/docker/containers'),
  startDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/start`, { method: 'POST' }),
  stopDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/stop`, { method: 'POST' }),
  restartDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/restart`, { method: 'POST' }),
  removeDockerContainer: (id: string, force = false) =>
    request<{ success: boolean }>(`/docker/containers/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  viewContainerLogs: (containerId: string, sessionId: string) =>
    request<{ success: boolean; terminalId: string }>(`/docker/containers/${containerId}/logs`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  dockerBuild: (dockerfilePath: string, contextDir: string, tag?: string, sessionId?: string) =>
    request<{ success: boolean; output: string }>('/docker/build', {
      method: 'POST',
      body: JSON.stringify({ dockerfilePath, contextDir, tag, sessionId }),
    }),
  dockerRun: (data: { image: string; name?: string; ports?: string[]; env?: Record<string, string> }) =>
    request<{ success: boolean; containerId: string }>('/docker/run', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  dockerComposeUp: (composePath: string, sessionId?: string) =>
    request<{ success: boolean; output: string }>('/docker/compose/up', {
      method: 'POST',
      body: JSON.stringify({ composePath, sessionId }),
    }),
  dockerComposeDown: (composePath: string, sessionId?: string) =>
    request<{ success: boolean; output: string }>('/docker/compose/down', {
      method: 'POST',
      body: JSON.stringify({ composePath, sessionId }),
    }),
  dockerComposePs: (composePath: string) =>
    request<{ containers: DockerContainer[] }>(`/docker/compose/ps?composePath=${encodeURIComponent(composePath)}`),
  detectDockerFiles: (projectId: string) =>
    request<{ files: DockerFile[] }>(`/docker/detect/${projectId}`),
  getDockerStatus: () =>
    request<{ available: boolean }>('/docker/status'),
  getSystemStats: () =>
    request<SystemStats>('/docker/stats'),

  // ─── Skills ──────────────────────────────────────────────────────────────

  getInstalledSkills: () =>
    request<{ skills: InstalledSkill[] }>('/skills'),
  searchSkills: (query: string) =>
    request<{ skills: RegistrySkill[]; source: string }>(`/skills/search?q=${encodeURIComponent(query)}`),
  getTrendingSkills: () =>
    request<{ skills: RegistrySkill[] }>('/skills/trending'),
  installSkill: (repo: string, skillName?: string, useCLI?: boolean) =>
    request<{ success: boolean; installed?: string[]; output?: string }>('/skills/install', {
      method: 'POST',
      body: JSON.stringify({ repo, skillName, useCLI }),
    }),
  uninstallSkill: (name: string) =>
    request<{ success: boolean }>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // ─── MCP Servers ────────────────────────────────────────────────────────────

  searchMcpServers: (query: string, cursor?: string) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (cursor) params.set('cursor', cursor);
    return request<{ servers: McpRegistryServer[]; nextCursor?: string }>(`/mcp/search?${params}`);
  },
  getMcpServer: (name: string) =>
    request<{ server: McpRegistryServer }>(`/mcp/servers/${encodeURIComponent(name)}`),
  getInstalledMcpServers: () =>
    request<{ servers: McpInstalledServer[] }>('/mcp/installed'),
  installMcpServer: (server: McpRegistryServer, configName: string, envVars?: Record<string, string>, extraArgs?: string[]) =>
    request<{ success: boolean }>('/mcp/install', {
      method: 'POST',
      body: JSON.stringify({ server, configName, envVars, extraArgs }),
    }),
  addCustomMcpServer: (name: string, command: string, args?: string[], env?: Record<string, string>) =>
    request<{ success: boolean }>('/mcp/custom', {
      method: 'POST',
      body: JSON.stringify({ name, command, args, env }),
    }),
  updateMcpServer: (name: string, config: { command?: string; args?: string[]; env?: Record<string, string> }) =>
    request<{ success: boolean }>(`/mcp/installed/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  uninstallMcpServer: (name: string) =>
    request<{ success: boolean }>(`/mcp/installed/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getMcpRawConfig: () =>
    request<{ config: Record<string, McpServerConfig> }>('/mcp/config'),
  setMcpRawConfig: (config: Record<string, McpServerConfig>) =>
    request<{ success: boolean }>('/mcp/config', {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),

  // Presentation
  addPresentationAnnotation: (sessionId: string, slideId: string, text: string) =>
    request<SlideAnnotation>(`/sessions/${sessionId}/presentation/annotations`, {
      method: 'POST',
      body: JSON.stringify({ slideId, text }),
    }),
  deletePresentationAnnotation: (sessionId: string, annotationId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/presentation/annotations/${annotationId}`, {
      method: 'DELETE',
    }),
  getPresentationAnnotations: (sessionId: string, slideId?: string) => {
    const params = new URLSearchParams();
    if (slideId) params.set('slideId', slideId);
    const query = params.toString();
    return request<SlideAnnotation[]>(`/sessions/${sessionId}/presentation/annotations${query ? `?${query}` : ''}`);
  },
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
  isMultiProject: boolean;
  env?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  git?: GitStatus;
  childLinks?: ProjectLink[];
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string[];
  parents: string[];
}

export interface GitBranches {
  local: string[];
  remote: string[];
  current: string;
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

export interface NotificationAction {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface NotificationOption {
  label: string;
  value: string;
  isDefault?: boolean;
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
    classifications?: string[];
    options?: NotificationOption[];
    freeformAllowed?: boolean;
    [key: string]: unknown;
  } | null;
  actions?: NotificationAction[] | null;
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

export type TerminalType = 'shell' | 'claude' | 'process';

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
  cwd?: string;
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

// ─── Kanban Types ────────────────────────────────────────────────────────────

export type KanbanStatus = 'backlog' | 'todo' | 'in_progress' | 'manual_testing' | 'review_needed' | 'completed';
export type KanbanPriority = 'low' | 'medium' | 'high' | 'critical';
export type AssigneeType = 'user' | 'agent' | 'unassigned';
export type TaskCommentStatus = 'open' | 'resolved' | 'rejected';
export type CLIAdapterType = 'claude_code' | 'gemini_cli' | 'custom';

export interface KanbanTask {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  userId: string;
  title: string;
  description: string | null;
  status: KanbanStatus;
  priority: KanbanPriority;
  position: number;
  assigneeType: AssigneeType;
  assigneeId: string | null;
  sessionId: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  branch: string | null;
  autoFlow: boolean;
  adapterType: CLIAdapterType | null;
  adapterConfig: string | null;
  labels: string | null; // JSON array
  estimatedEffort: string | null;
  createdAt: string;
  updatedAt: string;
  project?: Project;
  subtasks?: KanbanTask[];
  comments?: TaskComment[];
  attachments?: TaskAttachment[];
  dependencies?: TaskDependency[];
  dependents?: TaskDependency[];
  session?: Session;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  parentCommentId: string | null;
  content: string;
  status: TaskCommentStatus;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; email: string; image?: string };
  replies?: TaskComment[];
  attachments?: TaskAttachment[];
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  commentId: string | null;
  userId: string;
  filename: string;
  filepath: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface TaskDependency {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  dependsOn?: KanbanTask;
  task?: KanbanTask;
}

export interface KanbanColumn {
  id: KanbanStatus;
  title: string;
  tasks: KanbanTask[];
  count: number;
}

export interface KanbanBoardData {
  columns: KanbanColumn[];
  summary: Record<string, number>;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  parentTaskId?: string;
  assigneeType?: AssigneeType;
  assigneeId?: string;
  autoFlow?: boolean;
  adapterType?: CLIAdapterType;
  labels?: string[];
  branch?: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  position?: number;
  parentTaskId?: string | null;
  assigneeType?: AssigneeType;
  assigneeId?: string | null;
  sessionId?: string | null;
  autoFlow?: boolean;
  adapterType?: CLIAdapterType;
  labels?: string[];
  branch?: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  estimatedEffort?: string;
}

export interface TaskFiltersInput {
  projectId?: string;
  status?: string;
  priority?: string;
  assigneeType?: string;
  assigneeId?: string;
  sessionId?: string;
  search?: string;
  parentTaskId?: string;
  topLevel?: string;
  limit?: string;
  offset?: string;
}

export interface AutoFlow {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string | null;
  triggerType: 'on_complete' | 'manual' | 'cron';
  cronExpression: string | null;
  adapterType: CLIAdapterType;
  adapterConfig: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  steps?: FlowStep[];
  project?: Project;
}

export interface FlowStep {
  id: string;
  flowId: string;
  taskId: string;
  stepOrder: number;
  adapterType: CLIAdapterType;
  config: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  sessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  output: string | null;
  createdAt: string;
  updatedAt: string;
  task?: KanbanTask;
}

export interface CLIAdapterInfo {
  name: string;
  type: CLIAdapterType;
  available: boolean;
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

// ─── Run Config Types ─────────────────────────────────────────────────────────

export type RunConfigAdapterType = 'npm_script' | 'custom_command' | 'browser_preview';

export interface RunConfig {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  adapterType: RunConfigAdapterType;
  command: Record<string, unknown>;
  cwd: string | null;
  env: Record<string, string> | null;
  autoRestart: boolean;
  position: number;
  isRunning: boolean;
  activeTerminalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackageJsonScript {
  name: string;
  command: string;
}

export interface CreateRunConfigInput {
  projectId: string;
  name: string;
  adapterType: RunConfigAdapterType;
  command: Record<string, unknown>;
  cwd?: string;
  env?: Record<string, string>;
  autoRestart?: boolean;
}

export interface UpdateRunConfigInput {
  name?: string;
  adapterType?: RunConfigAdapterType;
  command?: Record<string, unknown>;
  cwd?: string | null;
  env?: Record<string, string> | null;
  autoRestart?: boolean;
  position?: number;
}

// ─── Browser Preview Types ────────────────────────────────────────────────────

export type ViewportPreset = 'mobile' | 'tablet' | 'desktop' | 'desktop_hd';

export interface BrowserPreview {
  id: string;
  url: string;
  viewport: ViewportPreset;
  status: 'starting' | 'running' | 'stopped' | 'error';
}

// ─── Multi-Project & Sidebar Types ──────────────────────────────────────────

export interface ProjectLink {
  id: string;
  parentProjectId: string;
  childProjectId: string;
  alias: string;
  position: number;
  createdAt: string;
  childProject?: Project;
}

export interface CreateMultiProjectInput {
  name: string;
  links: Array<{ projectId: string; alias: string }>;
}

export interface SidebarSession {
  id: string;
  status: string;
  liveStatus: string;
  branchName: string;
  diffStats: { additions: number; deletions: number } | null;
  commentCount: number;
}

export interface SidebarProject {
  id: string;
  name: string;
  isMultiProject: boolean;
  linkedProjects?: Array<{ id: string; alias: string; name: string }>;
  sessions: SidebarSession[];
}

export interface SidebarData {
  projects: SidebarProject[];
  unassignedSessions: SidebarSession[];
}

// ─── Docker Types ────────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

export interface DockerFile {
  path: string;
  type: 'dockerfile' | 'compose';
  name: string;
}

export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
}

// ─── MCP Server Types ─────────────────────────────────────────────────────────

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

// ─── Skills Types ────────────────────────────────────────────────────────────

export interface InstalledSkill {
  name: string;
  description: string;
  license?: string;
  mode?: boolean;
  allowedTools?: string[];
  path: string;
  isSymlink: boolean;
  installedAt: string;
  source?: string;
}

export interface RegistrySkill {
  name: string;
  description: string;
  repo: string;
  installs: number;
  trending?: number;
}

// ─── Presentation Types ──────────────────────────────────────────────────────

export interface PresentationRequest {
  unstaged?: boolean;
  staged?: boolean;
  commitHashes?: string[];
  projectId?: string;
}

export interface SlidePlanEntry {
  title: string;
  files: string[];
  importance: 'high' | 'medium' | 'low';
  hunkSelectors: Array<{
    filePath: string;
    hunkIndices: number[];
  }>;
}

export interface SlidePlan {
  slides: SlidePlanEntry[];
  summary: string;
}

export interface DiffExcerpt {
  filePath: string;
  patch: string;
  explanation: string;
}

export interface SlideAnnotation {
  id: string;
  slideId: string;
  text: string;
  createdAt: string;
}

export interface PresentationSlide {
  id: string;
  index: number;
  title: string;
  narrative: string;
  importance: 'high' | 'medium' | 'low';
  files: string[];
  excerpts: DiffExcerpt[];
  fullDiff: string;
  annotations: SlideAnnotation[];
}
