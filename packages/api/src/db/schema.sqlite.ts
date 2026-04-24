import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql, relations } from 'drizzle-orm';

// SQLite has no enums — use text columns instead.
// Enum values are documented in comments for reference.

// Better Auth tables
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// App-specific user data
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// GitHub Apps
export const githubApps = sqliteTable('github_apps', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  appId: integer('app_id').notNull(),
  appSlug: text('app_slug').notNull(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull(),
  clientSecret: text('client_secret').notNull(),
  privateKey: text('private_key').notNull(),
  webhookSecret: text('webhook_secret'),
  htmlUrl: text('html_url').notNull(),
  permissions: text('permissions'), // JSON
  events: text('events'), // JSON
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// GitHub App installations
export const githubAppInstallations = sqliteTable('github_app_installations', {
  id: text('id').primaryKey(),
  githubAppId: text('github_app_id').references(() => githubApps.id, { onDelete: 'cascade' }).notNull(),
  installationId: integer('installation_id').notNull(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(), // "User" or "Organization"
  repositorySelection: text('repository_selection'), // "all" or "selected"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Projects
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  repoUrl: text('repo_url'),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').default('main'),
  sshKeyId: text('ssh_key_id').references(() => sshKeys.id),
  githubAppInstallationId: text('github_app_installation_id').references(() => githubAppInstallations.id, { onDelete: 'set null' }),
  isMultiProject: integer('is_multi_project', { mode: 'boolean' }).notNull().default(false),
  env: text('env'), // JSON — Record<string, string>
  sidebarPosition: integer('sidebar_position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Multi-project links
export const projectLinks = sqliteTable('project_links', {
  id: text('id').primaryKey(),
  parentProjectId: text('parent_project_id')
    .references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  childProjectId: text('child_project_id')
    .references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  alias: text('alias').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Git worktrees
export const worktrees = sqliteTable('worktrees', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  branch: text('branch').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Claude sessions — status: active | waiting_input | paused | terminated
export const claudeSessions = sqliteTable('claude_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  worktreeId: text('worktree_id').references(() => worktrees.id, { onDelete: 'set null' }),
  claudeSessionId: text('claude_session_id'),
  status: text('status').notNull().default('active'), // active | waiting_input | paused | terminated
  lastMessage: text('last_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// FCM tokens — platform: web | android | ios
export const fcmTokens = sqliteTable('fcm_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull(),
  deviceName: text('device_name'),
  platform: text('platform').default('web'), // web | android | ios
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Notification preferences
export const notificationPrefs = sqliteTable('notification_prefs', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  enabledAdapters: text('enabled_adapters').default('["firebase"]'),
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  notifyOnInput: integer('notify_on_input', { mode: 'boolean' }).default(true),
  notifyOnError: integer('notify_on_error', { mode: 'boolean' }).default(true),
  notifyOnComplete: integer('notify_on_complete', { mode: 'boolean' }).default(true),
});

// Persistent notifications — type/status/priority are text (no enums in SQLite)
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  terminalId: text('terminal_id'),

  type: text('type').notNull(), // user_input_required | permission_request | task_complete | error | session_started | session_ended
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: text('metadata'), // JSON
  actions: text('actions'), // JSON array
  priority: text('priority').default('normal'), // low | normal | high

  status: text('status').default('pending'), // pending | sent | read | resolved | dismissed
  resolvedAction: text('resolved_action'),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// SSH keys
export const sshKeys = sqliteTable('ssh_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  privateKeyPath: text('private_key_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Messages — role: user | assistant | system
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Terminals — type: shell | claude | process, status: running | exited
export const terminals = sqliteTable('terminals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull().default('Terminal'),
  type: text('type').notNull().default('shell'), // shell | claude | process
  command: text('command').notNull(), // JSON array
  cols: text('cols').notNull().default('80'),
  rows: text('rows').notNull().default('24'),
  persist: integer('persist', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('running'), // running | exited
  exitCode: text('exit_code'),
  scrollback: text('scrollback'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Code editors — status: starting | running | stopped
export const codeEditors = sqliteTable('code_editors', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull().unique(),
  port: integer('port').notNull(),
  status: text('status').notNull().default('starting'), // starting | running | stopped
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
});

// ─── Kanban Tables ──────────────────────────────────────────────────────────

export const kanbanTasks = sqliteTable('kanban_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  parentTaskId: text('parent_task_id'),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),

  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('backlog'), // backlog | todo | in_progress | manual_testing | review_needed | completed
  priority: text('priority').notNull().default('medium'), // low | medium | high | critical
  position: integer('position').notNull().default(0),

  assigneeType: text('assignee_type').notNull().default('unassigned'), // user | agent | unassigned
  assigneeId: text('assignee_id'),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'set null' }),

  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  branch: text('branch'),

  autoFlow: integer('auto_flow', { mode: 'boolean' }).notNull().default(false),
  adapterType: text('adapter_type').default('claude_code'), // claude_code | gemini_cli | custom
  adapterConfig: text('adapter_config'), // JSON

  labels: text('labels'), // JSON array
  estimatedEffort: text('estimated_effort'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const kanbanTaskDependencies = sqliteTable('kanban_task_dependencies', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  dependsOnTaskId: text('depends_on_task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const kanbanTaskComments = sqliteTable('kanban_task_comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  parentCommentId: text('parent_comment_id'),
  content: text('content').notNull(),
  status: text('status').notNull().default('open'), // open | resolved | rejected
  resolvedBy: text('resolved_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const kanbanTaskAttachments = sqliteTable('kanban_task_attachments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  commentId: text('comment_id').references(() => kanbanTaskComments.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const kanbanAutoFlows = sqliteTable('kanban_auto_flows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: text('trigger_type').notNull().default('on_complete'), // on_complete | manual | cron
  cronExpression: text('cron_expression'),
  adapterType: text('adapter_type').notNull().default('claude_code'), // claude_code | gemini_cli | custom
  adapterConfig: text('adapter_config'), // JSON
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const kanbanFlowSteps = sqliteTable('kanban_flow_steps', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').references(() => kanbanAutoFlows.id, { onDelete: 'cascade' }).notNull(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  stepOrder: integer('step_order').notNull(),
  adapterType: text('adapter_type').notNull().default('claude_code'), // claude_code | gemini_cli | custom
  config: text('config'), // JSON
  status: text('status').notNull().default('pending'), // pending | running | completed | failed | skipped
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'set null' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  output: text('output'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Review comments — status: pending | running | resolved, lineSide: additions | deletions
export const reviewComments = sqliteTable('review_comments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  batchId: text('batch_id'),
  filePath: text('file_path').notNull(),
  lineNumber: integer('line_number').notNull(),
  lineSide: text('line_side').notNull(), // additions | deletions
  lineContent: text('line_content').notNull(),
  fileSha: text('file_sha'),
  comment: text('comment').notNull(),
  status: text('status').notNull().default('pending'), // pending | running | resolved
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
});

// ─── Run Configurations ─────────────────────────────────────────────────────

export const runConfigs = sqliteTable('run_configs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(), // npm_script | custom_command | browser_preview
  command: text('command').notNull(), // JSON
  cwd: text('cwd'),
  env: text('env'), // JSON
  autoRestart: integer('auto_restart', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const runConfigInstances = sqliteTable('run_config_instances', {
  id: text('id').primaryKey(),
  runConfigId: text('run_config_id').references(() => runConfigs.id, { onDelete: 'cascade' }).notNull(),
  terminalId: text('terminal_id').references(() => terminals.id, { onDelete: 'set null' }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
});

// Artifacts — type: screenshot | file | log
export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  terminalId: text('terminal_id'),
  type: text('type').notNull(), // screenshot | file | log
  toolName: text('tool_name'),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// App settings (key-value store)
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Paired machines — role: 'master' | 'secondary'
export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  sessionCount: integer('session_count').notNull().default(0),
  version: text('version'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const pairingTokens = sqliteTable('pairing_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const pairedMasters = sqliteTable('paired_masters', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  name: text('name').notNull(),
  machineToken: text('machine_token').notNull(),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncError: text('last_sync_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ─── Relations (identical for both pg and sqlite) ───────────────────────────

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  profile: one(userProfiles, {
    fields: [user.id],
    references: [userProfiles.userId],
  }),
  projects: many(projects),
  claudeSessions: many(claudeSessions),
  fcmTokens: many(fcmTokens),
  sshKeys: many(sshKeys),
  githubApps: many(githubApps),
  notificationPrefs: one(notificationPrefs, {
    fields: [user.id],
    references: [notificationPrefs.userId],
  }),
  notifications: many(notifications),
  kanbanTasks: many(kanbanTasks),
  kanbanComments: many(kanbanTaskComments),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, {
    fields: [userProfiles.userId],
    references: [user.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(user, {
    fields: [projects.userId],
    references: [user.id],
  }),
  sshKey: one(sshKeys, {
    fields: [projects.sshKeyId],
    references: [sshKeys.id],
  }),
  githubAppInstallation: one(githubAppInstallations, {
    fields: [projects.githubAppInstallationId],
    references: [githubAppInstallations.id],
  }),
  claudeSessions: many(claudeSessions),
  kanbanTasks: many(kanbanTasks),
  kanbanAutoFlows: many(kanbanAutoFlows),
  runConfigs: many(runConfigs),
  childLinks: many(projectLinks, { relationName: 'childLinks' }),
  parentLinks: many(projectLinks, { relationName: 'parentLinks' }),
  worktrees: many(worktrees),
}));

export const projectLinksRelations = relations(projectLinks, ({ one }) => ({
  parentProject: one(projects, {
    fields: [projectLinks.parentProjectId],
    references: [projects.id],
    relationName: 'childLinks',
  }),
  childProject: one(projects, {
    fields: [projectLinks.childProjectId],
    references: [projects.id],
    relationName: 'parentLinks',
  }),
}));

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, {
    fields: [worktrees.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [worktrees.userId],
    references: [user.id],
  }),
  sessions: many(claudeSessions),
}));

export const claudeSessionsRelations = relations(claudeSessions, ({ one, many }) => ({
  user: one(user, {
    fields: [claudeSessions.userId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [claudeSessions.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
  terminals: many(terminals),
  codeEditors: many(codeEditors),
  reviewComments: many(reviewComments),
  notifications: many(notifications),
  artifacts: many(artifacts),
  worktree: one(worktrees, {
    fields: [claudeSessions.worktreeId],
    references: [worktrees.id],
  }),
}));

export const fcmTokensRelations = relations(fcmTokens, ({ one }) => ({
  user: one(user, {
    fields: [fcmTokens.userId],
    references: [user.id],
  }),
}));

export const notificationPrefsRelations = relations(notificationPrefs, ({ one }) => ({
  user: one(user, {
    fields: [notificationPrefs.userId],
    references: [user.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
  session: one(claudeSessions, {
    fields: [notifications.sessionId],
    references: [claudeSessions.id],
  }),
}));

export const sshKeysRelations = relations(sshKeys, ({ one, many }) => ({
  user: one(user, {
    fields: [sshKeys.userId],
    references: [user.id],
  }),
  projects: many(projects),
}));

export const githubAppsRelations = relations(githubApps, ({ one, many }) => ({
  user: one(user, {
    fields: [githubApps.userId],
    references: [user.id],
  }),
  installations: many(githubAppInstallations),
}));

export const githubAppInstallationsRelations = relations(githubAppInstallations, ({ one, many }) => ({
  githubApp: one(githubApps, {
    fields: [githubAppInstallations.githubAppId],
    references: [githubApps.id],
  }),
  projects: many(projects),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [messages.sessionId],
    references: [claudeSessions.id],
  }),
}));

export const terminalsRelations = relations(terminals, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [terminals.sessionId],
    references: [claudeSessions.id],
  }),
}));

export const codeEditorsRelations = relations(codeEditors, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [codeEditors.sessionId],
    references: [claudeSessions.id],
  }),
}));

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [reviewComments.sessionId],
    references: [claudeSessions.id],
  }),
}));

// ─── Kanban Relations ───────────────────────────────────────────────────────

export const kanbanTasksRelations = relations(kanbanTasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [kanbanTasks.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [kanbanTasks.userId],
    references: [user.id],
  }),
  parentTask: one(kanbanTasks, {
    fields: [kanbanTasks.parentTaskId],
    references: [kanbanTasks.id],
    relationName: 'subtasks',
  }),
  subtasks: many(kanbanTasks, { relationName: 'subtasks' }),
  session: one(claudeSessions, {
    fields: [kanbanTasks.sessionId],
    references: [claudeSessions.id],
  }),
  comments: many(kanbanTaskComments),
  attachments: many(kanbanTaskAttachments),
  dependencies: many(kanbanTaskDependencies, { relationName: 'taskDeps' }),
  dependents: many(kanbanTaskDependencies, { relationName: 'taskDependents' }),
  flowSteps: many(kanbanFlowSteps),
}));

export const kanbanTaskDependenciesRelations = relations(kanbanTaskDependencies, ({ one }) => ({
  task: one(kanbanTasks, {
    fields: [kanbanTaskDependencies.taskId],
    references: [kanbanTasks.id],
    relationName: 'taskDeps',
  }),
  dependsOn: one(kanbanTasks, {
    fields: [kanbanTaskDependencies.dependsOnTaskId],
    references: [kanbanTasks.id],
    relationName: 'taskDependents',
  }),
}));

export const kanbanTaskCommentsRelations = relations(kanbanTaskComments, ({ one, many }) => ({
  task: one(kanbanTasks, {
    fields: [kanbanTaskComments.taskId],
    references: [kanbanTasks.id],
  }),
  user: one(user, {
    fields: [kanbanTaskComments.userId],
    references: [user.id],
  }),
  parentComment: one(kanbanTaskComments, {
    fields: [kanbanTaskComments.parentCommentId],
    references: [kanbanTaskComments.id],
    relationName: 'replies',
  }),
  replies: many(kanbanTaskComments, { relationName: 'replies' }),
  attachments: many(kanbanTaskAttachments),
}));

export const kanbanTaskAttachmentsRelations = relations(kanbanTaskAttachments, ({ one }) => ({
  task: one(kanbanTasks, {
    fields: [kanbanTaskAttachments.taskId],
    references: [kanbanTasks.id],
  }),
  comment: one(kanbanTaskComments, {
    fields: [kanbanTaskAttachments.commentId],
    references: [kanbanTaskComments.id],
  }),
  user: one(user, {
    fields: [kanbanTaskAttachments.userId],
    references: [user.id],
  }),
}));

export const kanbanAutoFlowsRelations = relations(kanbanAutoFlows, ({ one, many }) => ({
  project: one(projects, {
    fields: [kanbanAutoFlows.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [kanbanAutoFlows.userId],
    references: [user.id],
  }),
  steps: many(kanbanFlowSteps),
}));

export const kanbanFlowStepsRelations = relations(kanbanFlowSteps, ({ one }) => ({
  flow: one(kanbanAutoFlows, {
    fields: [kanbanFlowSteps.flowId],
    references: [kanbanAutoFlows.id],
  }),
  task: one(kanbanTasks, {
    fields: [kanbanFlowSteps.taskId],
    references: [kanbanTasks.id],
  }),
  session: one(claudeSessions, {
    fields: [kanbanFlowSteps.sessionId],
    references: [claudeSessions.id],
  }),
}));

// ─── Run Config Relations ─────────────────────────────────────────────────

export const runConfigsRelations = relations(runConfigs, ({ one, many }) => ({
  project: one(projects, {
    fields: [runConfigs.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [runConfigs.userId],
    references: [user.id],
  }),
  instances: many(runConfigInstances),
}));

export const runConfigInstancesRelations = relations(runConfigInstances, ({ one }) => ({
  runConfig: one(runConfigs, {
    fields: [runConfigInstances.runConfigId],
    references: [runConfigs.id],
  }),
  terminal: one(terminals, {
    fields: [runConfigInstances.terminalId],
    references: [terminals.id],
  }),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [artifacts.sessionId],
    references: [claudeSessions.id],
  }),
}));

// Type exports
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ClaudeSession = typeof claudeSessions.$inferSelect;
export type NewClaudeSession = typeof claudeSessions.$inferInsert;
export type FCMToken = typeof fcmTokens.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Terminal = typeof terminals.$inferSelect;
export type NewTerminal = typeof terminals.$inferInsert;
export type ReviewComment = typeof reviewComments.$inferSelect;
export type NewReviewComment = typeof reviewComments.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type KanbanTask = typeof kanbanTasks.$inferSelect;
export type NewKanbanTask = typeof kanbanTasks.$inferInsert;
export type KanbanTaskDependency = typeof kanbanTaskDependencies.$inferSelect;
export type KanbanTaskComment = typeof kanbanTaskComments.$inferSelect;
export type NewKanbanTaskComment = typeof kanbanTaskComments.$inferInsert;
export type KanbanTaskAttachment = typeof kanbanTaskAttachments.$inferSelect;
export type KanbanAutoFlow = typeof kanbanAutoFlows.$inferSelect;
export type NewKanbanAutoFlow = typeof kanbanAutoFlows.$inferInsert;
export type KanbanFlowStep = typeof kanbanFlowSteps.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type RunConfig = typeof runConfigs.$inferSelect;
export type NewRunConfig = typeof runConfigs.$inferInsert;
export type RunConfigInstance = typeof runConfigInstances.$inferSelect;
export type CodeEditor = typeof codeEditors.$inferSelect;
export type NewCodeEditor = typeof codeEditors.$inferInsert;
export type ProjectLink = typeof projectLinks.$inferSelect;
export type NewProjectLink = typeof projectLinks.$inferInsert;
export type Worktree = typeof worktrees.$inferSelect;
export type NewWorktree = typeof worktrees.$inferInsert;
export type GitHubApp = typeof githubApps.$inferSelect;
export type NewGitHubApp = typeof githubApps.$inferInsert;
export type GitHubAppInstallation = typeof githubAppInstallations.$inferSelect;
export type NewGitHubAppInstallation = typeof githubAppInstallations.$inferInsert;
