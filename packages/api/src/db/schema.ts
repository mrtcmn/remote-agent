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
