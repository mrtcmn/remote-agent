// Conditional schema shim.
// Runtime tables/relations come from schema.sqlite (local mode) or schema.pg
// (remote mode). Type aliases come from schema.pg — column shapes match between
// drivers so insert/select inference stays correct in both modes.
//
// Without this, every consumer importing tables from `'../db'` or
// `'../db/schema'` would get the PostgreSQL definitions (with `defaultNow()`
// → `now()`) and break under SQLite ("no such function: now").

import { isLocalMode } from '../config/mode';

const _s = (isLocalMode()
  ? await import('./schema.sqlite')
  : await import('./schema.pg')) as unknown as typeof import('./schema.pg');

// ─── Tables ─────────────────────────────────────────────────────────────────
export const user = _s.user;
export const session = _s.session;
export const account = _s.account;
export const verification = _s.verification;
export const userProfiles = _s.userProfiles;
export const githubApps = _s.githubApps;
export const githubAppInstallations = _s.githubAppInstallations;
export const projects = _s.projects;
export const projectLinks = _s.projectLinks;
export const worktrees = _s.worktrees;
export const claudeSessions = _s.claudeSessions;
export const fcmTokens = _s.fcmTokens;
export const notificationPrefs = _s.notificationPrefs;
export const notifications = _s.notifications;
export const sshKeys = _s.sshKeys;
export const sshCredentials = _s.sshCredentials;
export const sshGroups = _s.sshGroups;
export const sshHosts = _s.sshHosts;
export const sshLogEvents = _s.sshLogEvents;
export const messages = _s.messages;
export const terminals = _s.terminals;
export const codeEditors = _s.codeEditors;
export const kanbanTasks = _s.kanbanTasks;
export const kanbanTaskDependencies = _s.kanbanTaskDependencies;
export const kanbanTaskComments = _s.kanbanTaskComments;
export const kanbanTaskAttachments = _s.kanbanTaskAttachments;
export const kanbanAutoFlows = _s.kanbanAutoFlows;
export const kanbanFlowSteps = _s.kanbanFlowSteps;
export const reviewComments = _s.reviewComments;
export const runConfigs = _s.runConfigs;
export const runConfigInstances = _s.runConfigInstances;
export const runFlows = _s.runFlows;
export const runFlowNodes = _s.runFlowNodes;
export const runFlowEdges = _s.runFlowEdges;
export const artifacts = _s.artifacts;
export const appSettings = _s.appSettings;
export const machines = _s.machines;
export const pairingTokens = _s.pairingTokens;
export const pairedMasters = _s.pairedMasters;

// ─── Relations ──────────────────────────────────────────────────────────────
export const userRelations = _s.userRelations;
export const sessionRelations = _s.sessionRelations;
export const accountRelations = _s.accountRelations;
export const userProfilesRelations = _s.userProfilesRelations;
export const projectsRelations = _s.projectsRelations;
export const projectLinksRelations = _s.projectLinksRelations;
export const worktreesRelations = _s.worktreesRelations;
export const claudeSessionsRelations = _s.claudeSessionsRelations;
export const fcmTokensRelations = _s.fcmTokensRelations;
export const notificationPrefsRelations = _s.notificationPrefsRelations;
export const notificationsRelations = _s.notificationsRelations;
export const sshKeysRelations = _s.sshKeysRelations;
export const githubAppsRelations = _s.githubAppsRelations;
export const githubAppInstallationsRelations = _s.githubAppInstallationsRelations;
export const messagesRelations = _s.messagesRelations;
export const terminalsRelations = _s.terminalsRelations;
export const codeEditorsRelations = _s.codeEditorsRelations;
export const reviewCommentsRelations = _s.reviewCommentsRelations;
export const kanbanTasksRelations = _s.kanbanTasksRelations;
export const kanbanTaskDependenciesRelations = _s.kanbanTaskDependenciesRelations;
export const kanbanTaskCommentsRelations = _s.kanbanTaskCommentsRelations;
export const kanbanTaskAttachmentsRelations = _s.kanbanTaskAttachmentsRelations;
export const kanbanAutoFlowsRelations = _s.kanbanAutoFlowsRelations;
export const kanbanFlowStepsRelations = _s.kanbanFlowStepsRelations;
export const runConfigsRelations = _s.runConfigsRelations;
export const runConfigInstancesRelations = _s.runConfigInstancesRelations;
export const runFlowsRelations = _s.runFlowsRelations;
export const runFlowNodesRelations = _s.runFlowNodesRelations;
export const runFlowEdgesRelations = _s.runFlowEdgesRelations;
export const artifactsRelations = _s.artifactsRelations;

// ─── Type aliases (compile-time only) ───────────────────────────────────────
export type * from './schema.pg';
