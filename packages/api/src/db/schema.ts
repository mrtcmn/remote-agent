import { pgTable, text, boolean, timestamp, pgEnum, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const sessionStatusEnum = pgEnum('session_status', ['active', 'waiting_input', 'paused', 'terminated']);
export const platformEnum = pgEnum('platform', ['web', 'android', 'ios']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);
export const terminalStatusEnum = pgEnum('terminal_status', ['running', 'exited']);
export const terminalTypeEnum = pgEnum('terminal_type', ['shell', 'claude']);
export const reviewCommentStatusEnum = pgEnum('review_comment_status', ['pending', 'running', 'resolved']);
export const lineSideEnum = pgEnum('line_side', ['additions', 'deletions']);

export const notificationTypeEnum = pgEnum('notification_type', [
  'user_input_required',
  'permission_request',
  'task_complete',
  'error',
  'session_started',
  'session_ended',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'read',
  'resolved',
  'dismissed',
]);

export const notificationPriorityEnum = pgEnum('notification_priority', ['low', 'normal', 'high']);

// Better Auth tables
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// App-specific user data (linked to better-auth user)
export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Projects
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  repoUrl: text('repo_url'),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').default('main'),
  sshKeyId: text('ssh_key_id').references(() => sshKeys.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Claude sessions
export const claudeSessions = pgTable('claude_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  claudeSessionId: text('claude_session_id'), // For --resume
  status: sessionStatusEnum('status').notNull().default('active'),
  lastMessage: text('last_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at').notNull().defaultNow(),
});

// FCM tokens for push notifications
export const fcmTokens = pgTable('fcm_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull(),
  deviceName: text('device_name'),
  platform: platformEnum('platform').default('web'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Notification preferences
export const notificationPrefs = pgTable('notification_prefs', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  enabledAdapters: text('enabled_adapters').default('["firebase"]'), // JSON array
  quietHoursStart: text('quiet_hours_start'), // HH:MM format
  quietHoursEnd: text('quiet_hours_end'),
  notifyOnInput: boolean('notify_on_input').default(true),
  notifyOnError: boolean('notify_on_error').default(true),
  notifyOnComplete: boolean('notify_on_complete').default(true),
});

// Persistent notifications
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  terminalId: text('terminal_id'),

  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: text('metadata'), // JSON
  actions: text('actions'), // JSON array of NotificationAction
  priority: notificationPriorityEnum('priority').default('normal'),

  status: notificationStatusEnum('status').default('pending'),
  resolvedAction: text('resolved_action'),
  resolvedAt: timestamp('resolved_at'),
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// SSH keys for git operations
export const sshKeys = pgTable('ssh_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  privateKeyPath: text('private_key_path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Message history for sessions
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON for tool calls, etc.
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Terminals for PTY sessions
export const terminals = pgTable('terminals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull().default('Terminal'),
  type: terminalTypeEnum('type').notNull().default('shell'),
  command: text('command').notNull(), // JSON array: ["bash"] or ["claude", ...]
  cols: text('cols').notNull().default('80'),
  rows: text('rows').notNull().default('24'),
  persist: boolean('persist').notNull().default(false),
  status: terminalStatusEnum('status').notNull().default('running'),
  exitCode: text('exit_code'),
  scrollback: text('scrollback'), // Only populated if persist=true
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Kanban Enums ───────────────────────────────────────────────────────────

export const kanbanStatusEnum = pgEnum('kanban_status', [
  'backlog', 'todo', 'in_progress', 'manual_testing', 'review_needed', 'completed',
]);

export const kanbanPriorityEnum = pgEnum('kanban_priority', ['low', 'medium', 'high', 'critical']);

export const assigneeTypeEnum = pgEnum('assignee_type', ['user', 'agent', 'unassigned']);

export const taskCommentStatusEnum = pgEnum('task_comment_status', ['open', 'resolved', 'rejected']);

export const autoFlowTriggerEnum = pgEnum('auto_flow_trigger', ['on_complete', 'manual', 'cron']);

export const flowStepStatusEnum = pgEnum('flow_step_status', ['pending', 'running', 'completed', 'failed', 'skipped']);

export const cliAdapterTypeEnum = pgEnum('cli_adapter_type', ['claude_code', 'gemini_cli', 'custom']);

// ─── Kanban Tables ──────────────────────────────────────────────────────────

export const kanbanTasks = pgTable('kanban_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  parentTaskId: text('parent_task_id'), // Self-reference for sub-tasks
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),

  title: text('title').notNull(),
  description: text('description'),
  status: kanbanStatusEnum('status').notNull().default('backlog'),
  priority: kanbanPriorityEnum('priority').notNull().default('medium'),
  position: integer('position').notNull().default(0),

  assigneeType: assigneeTypeEnum('assignee_type').notNull().default('unassigned'),
  assigneeId: text('assignee_id'), // userId when assigneeType is 'user'
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'set null' }),

  // GitHub integration
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  branch: text('branch'),

  // Auto-flow
  autoFlow: boolean('auto_flow').notNull().default(false),
  adapterType: cliAdapterTypeEnum('adapter_type').default('claude_code'),
  adapterConfig: text('adapter_config'), // JSON - adapter-specific config

  // Metadata
  labels: text('labels'), // JSON array of strings
  estimatedEffort: text('estimated_effort'), // e.g., "1h", "1d"

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kanbanTaskDependencies = pgTable('kanban_task_dependencies', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  dependsOnTaskId: text('depends_on_task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const kanbanTaskComments = pgTable('kanban_task_comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  parentCommentId: text('parent_comment_id'), // For threaded replies
  content: text('content').notNull(),
  status: taskCommentStatusEnum('status').notNull().default('open'),
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kanbanTaskAttachments = pgTable('kanban_task_attachments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  commentId: text('comment_id').references(() => kanbanTaskComments.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const kanbanAutoFlows = pgTable('kanban_auto_flows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: autoFlowTriggerEnum('trigger_type').notNull().default('on_complete'),
  cronExpression: text('cron_expression'),
  adapterType: cliAdapterTypeEnum('adapter_type').notNull().default('claude_code'),
  adapterConfig: text('adapter_config'), // JSON
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kanbanFlowSteps = pgTable('kanban_flow_steps', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').references(() => kanbanAutoFlows.id, { onDelete: 'cascade' }).notNull(),
  taskId: text('task_id').references(() => kanbanTasks.id, { onDelete: 'cascade' }).notNull(),
  stepOrder: integer('step_order').notNull(),
  adapterType: cliAdapterTypeEnum('adapter_type').notNull().default('claude_code'),
  config: text('config'), // JSON - step-specific config
  status: flowStepStatusEnum('status').notNull().default('pending'),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  output: text('output'), // Last output/summary
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Review comments for code annotations
export const reviewComments = pgTable('review_comments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  batchId: text('batch_id'),
  filePath: text('file_path').notNull(),
  lineNumber: integer('line_number').notNull(),
  lineSide: lineSideEnum('line_side').notNull(),
  lineContent: text('line_content').notNull(),
  fileSha: text('file_sha'),
  comment: text('comment').notNull(),
  status: reviewCommentStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});

// Relations
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
  claudeSessions: many(claudeSessions),
  kanbanTasks: many(kanbanTasks),
  kanbanAutoFlows: many(kanbanAutoFlows),
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
  reviewComments: many(reviewComments),
  notifications: many(notifications),
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

// App settings (key-value store)
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Type exports
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ClaudeSession = typeof claudeSessions.$inferSelect;
export type NewClaudeSession = typeof claudeSessions.$inferInsert;
export type FCMToken = typeof fcmTokens.$inferSelect;
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
