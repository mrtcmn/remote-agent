import { isLocalMode } from '../config/mode';

// Conditional re-export: SQLite schema for local mode, PostgreSQL for remote
const schema = isLocalMode()
  ? await import('./schema.sqlite')
  : await import('./schema.pg');

export const {
  // Tables
  user, session, account, verification, userProfiles,
  githubApps, githubAppInstallations,
  projects, projectLinks, worktrees,
  claudeSessions, fcmTokens, notificationPrefs, notifications,
  sshKeys, messages, terminals, codeEditors,
  kanbanTasks, kanbanTaskDependencies, kanbanTaskComments,
  kanbanTaskAttachments, kanbanAutoFlows, kanbanFlowSteps,
  reviewComments, runConfigs, runConfigInstances,
  artifacts, appSettings,

  // Relations
  userRelations, sessionRelations, accountRelations, userProfilesRelations,
  projectsRelations, projectLinksRelations, worktreesRelations,
  claudeSessionsRelations, fcmTokensRelations, notificationPrefsRelations,
  notificationsRelations, sshKeysRelations, githubAppsRelations,
  githubAppInstallationsRelations, messagesRelations, terminalsRelations,
  codeEditorsRelations, reviewCommentsRelations,
  kanbanTasksRelations, kanbanTaskDependenciesRelations,
  kanbanTaskCommentsRelations, kanbanTaskAttachmentsRelations,
  kanbanAutoFlowsRelations, kanbanFlowStepsRelations,
  runConfigsRelations, runConfigInstancesRelations, artifactsRelations,
} = schema;

// Re-export types
export type {
  User, NewUser, UserProfile,
  Project, NewProject,
  ClaudeSession, NewClaudeSession,
  FCMToken, Artifact, NewArtifact,
  SSHKey, Message, Terminal, NewTerminal,
  ReviewComment, NewReviewComment,
  Notification, NewNotification,
  KanbanTask, NewKanbanTask, KanbanTaskDependency,
  KanbanTaskComment, NewKanbanTaskComment,
  KanbanTaskAttachment, KanbanAutoFlow, NewKanbanAutoFlow,
  KanbanFlowStep, AppSetting,
  RunConfig, NewRunConfig, RunConfigInstance,
  CodeEditor, NewCodeEditor,
  ProjectLink, NewProjectLink,
  Worktree, NewWorktree,
  GitHubApp, NewGitHubApp,
  GitHubAppInstallation, NewGitHubAppInstallation,
} from './schema.pg';

// PG schema also exports enums — re-export them for backward compatibility.
// In SQLite mode these are unused but may be referenced by type-level code.
export {
  sessionStatusEnum, platformEnum, messageRoleEnum,
  terminalStatusEnum, terminalTypeEnum, reviewCommentStatusEnum,
  lineSideEnum, codeEditorStatusEnum,
  notificationTypeEnum, notificationStatusEnum, notificationPriorityEnum,
  kanbanStatusEnum, kanbanPriorityEnum, assigneeTypeEnum,
  taskCommentStatusEnum, autoFlowTriggerEnum, flowStepStatusEnum,
  cliAdapterTypeEnum, runConfigAdapterTypeEnum, artifactTypeEnum,
} from './schema.pg';
