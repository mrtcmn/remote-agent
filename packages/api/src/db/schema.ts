import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Better Auth tables
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// App-specific user data (linked to better-auth user)
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Claude sessions
export const claudeSessions = sqliteTable('claude_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  claudeSessionId: text('claude_session_id'), // For --resume
  status: text('status', { enum: ['active', 'waiting_input', 'paused', 'terminated'] }).notNull().default('active'),
  lastMessage: text('last_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// FCM tokens for push notifications
export const fcmTokens = sqliteTable('fcm_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull(),
  deviceName: text('device_name'),
  platform: text('platform', { enum: ['web', 'android', 'ios'] }).default('web'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Notification preferences
export const notificationPrefs = sqliteTable('notification_prefs', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  enabledAdapters: text('enabled_adapters').default('["firebase"]'), // JSON array
  quietHoursStart: text('quiet_hours_start'), // HH:MM format
  quietHoursEnd: text('quiet_hours_end'),
  notifyOnInput: integer('notify_on_input', { mode: 'boolean' }).default(true),
  notifyOnError: integer('notify_on_error', { mode: 'boolean' }).default(true),
  notifyOnComplete: integer('notify_on_complete', { mode: 'boolean' }).default(true),
});

// SSH keys for git operations
export const sshKeys = sqliteTable('ssh_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  privateKeyPath: text('private_key_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Message history for sessions
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON for tool calls, etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Terminals for PTY sessions
export const terminals = sqliteTable('terminals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull().default('Terminal'),
  command: text('command').notNull(), // JSON array: ["bash"] or ["claude", ...]
  cols: integer('cols').notNull().default(80),
  rows: integer('rows').notNull().default(24),
  persist: integer('persist', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['running', 'exited'] }).notNull().default('running'),
  exitCode: integer('exit_code'),
  scrollback: text('scrollback'), // Only populated if persist=true
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
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
