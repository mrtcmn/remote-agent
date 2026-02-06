import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { db, claudeSessions, projects } from '../db';
import { notificationService } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';

// Helper to get project name for a session
async function getSessionWithProject(sessionId: string) {
  const session = await db.query.claudeSessions.findFirst({
    where: eq(claudeSessions.id, sessionId),
  });

  if (!session) return null;

  let projectName: string | null = null;
  if (session.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });
    projectName = project?.name || null;
  }

  return { ...session, projectName };
}

// Helper to parse transcript and get summary
async function getTranscriptSummary(transcriptPath: string): Promise<{ stopReason?: string; summary?: string }> {
  try {
    // Expand ~ to home directory
    const expandedPath = transcriptPath.replace(/^~/, process.env.HOME || '');
    const content = await readFile(expandedPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse JSONL - last few entries
    const entries = lines.slice(-10).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Look for stop_reason in the last entries
    let stopReason: string | undefined;
    let summary: string | undefined;

    for (const entry of entries.reverse()) {
      // Check for stop_reason in the entry
      if (entry.stop_reason && !stopReason) {
        stopReason = entry.stop_reason;
      }
      // Look for last assistant message for summary
      if (entry.type === 'assistant' && entry.message?.content && !summary) {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          const textBlock = content.find((b: { type: string }) => b.type === 'text');
          if (textBlock?.text) {
            // Take first 200 chars as summary
            summary = textBlock.text.slice(0, 200);
            if (textBlock.text.length > 200) summary += '...';
          }
        } else if (typeof content === 'string') {
          summary = content.slice(0, 200);
          if (content.length > 200) summary += '...';
        }
      }
      if (stopReason && summary) break;
    }

    return { stopReason, summary };
  } catch (error) {
    console.error('Failed to parse transcript:', error);
    return {};
  }
}

// Internal routes for hooks (not authenticated, only accessible from localhost)
export const internalRoutes = new Elysia({ prefix: '/internal' })
  .onBeforeHandle(({ request, set }) => {
    // Only allow requests from localhost
    const host = request.headers.get('host') || '';
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
      set.status = 403;
      return { error: 'Forbidden' };
    }
  })

  // Hook callback for attention notifications (idle_prompt, permission_prompt)
  .post('/hooks/attention', async ({ body, set }) => {
    console.log('hooks/attention', body);
    const session = await getSessionWithProject(body.sessionId);

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Update session status
    await db.update(claudeSessions)
      .set({ status: 'waiting_input' })
      .where(eq(claudeSessions.id, body.sessionId));

    // Determine notification type from hook type field
    // Claude CLI sends: idle_prompt, permission_prompt, etc.
    const notificationType: NotificationType = body.type === 'permission_prompt'
      ? 'permission_request'
      : 'user_input_required';

    // Define actions based on type
    const actions: NotificationAction[] = notificationType === 'permission_request'
      ? [
          { label: 'Approve', action: 'approve' },
          { label: 'Deny', action: 'deny' },
        ]
      : [
          { label: 'Open', action: 'open' },
          { label: 'Reply', action: 'reply' },
        ];

    // Use the actual message from Claude CLI, fall back to body.prompt for backwards compat
    const messageBody = body.message || body.prompt || 'Attention required';

    // Build title with project name
    const baseTitle = notificationType === 'permission_request' ? 'Permission Request' : 'Attention Required';
    const title = session.projectName ? `${session.projectName}: ${baseTitle}` : baseTitle;

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: notificationType,
      title,
      body: messageBody,
      actions,
      priority: 'high',
      metadata: session.projectName ? { projectName: session.projectName } : undefined,
    });

    return {
      success: true,
      notificationId: result.notification.id,
      notification: result.sendResult,
    };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      type: t.Optional(t.String()),
      prompt: t.Optional(t.String()),
      // Fields from Claude CLI hooks
      message: t.Optional(t.String()),
      session_id: t.Optional(t.String()),
    }),
  })

  // Hook callback for task completion (Stop event)
  .post('/hooks/complete', async ({ body, set }) => {
    console.log('hooks/complete', body);
    const session = await getSessionWithProject(body.sessionId);

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Update session status to terminated (task complete)
    await db.update(claudeSessions)
      .set({ status: 'terminated' })
      .where(eq(claudeSessions.id, body.sessionId));

    // Dismiss pending notifications for this session (they're now irrelevant)
    await notificationService.dismissBySession(body.sessionId);

    // Parse transcript for summary if available
    let transcriptInfo: { stopReason?: string; summary?: string } = {};
    if (body.transcript_path) {
      transcriptInfo = await getTranscriptSummary(body.transcript_path);
    }

    // Build notification body with summary
    let notificationBody = body.prompt || 'Task completed';
    if (transcriptInfo.summary) {
      notificationBody = transcriptInfo.summary;
    }
    if (transcriptInfo.stopReason && transcriptInfo.stopReason !== 'end_turn') {
      notificationBody = `[${transcriptInfo.stopReason}] ${notificationBody}`;
    }

    // Build title with project name
    const title = session.projectName ? `${session.projectName}: Task Complete` : 'Task Complete';

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: 'task_complete' as NotificationType,
      title,
      body: notificationBody,
      actions: [{ label: 'View', action: 'view' }],
      priority: 'normal',
      metadata: {
        ...(session.projectName ? { projectName: session.projectName } : {}),
        ...(transcriptInfo.stopReason ? { stopReason: transcriptInfo.stopReason } : {}),
      },
    });

    return {
      success: true,
      notificationId: result.notification.id,
      notification: result.sendResult,
    };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      type: t.Optional(t.String()),
      prompt: t.Optional(t.String()),
      // Fields from Claude CLI hooks
      transcript_path: t.Optional(t.String()),
      session_id: t.Optional(t.String()),
      stop_hook_active: t.Optional(t.Boolean()),
      cwd: t.Optional(t.String()),
      permission_mode: t.Optional(t.String()),
      hook_event_name: t.Optional(t.String()),
    }),
  });
