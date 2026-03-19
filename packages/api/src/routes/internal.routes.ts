import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { db, claudeSessions, projects } from '../db';
import { notificationService } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';
import { notificationClassifier } from '../services/notification/classifier';
import type { NotificationClassification, ParsedOption } from '../services/notification/classifier';

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

// Convert parsed options from classifier into notification actions
function optionsToActions(options: ParsedOption[], freeformAllowed: boolean): NotificationAction[] {
  const actions: NotificationAction[] = options.map(opt => ({
    label: opt.label,
    action: opt.value,
    data: opt.isDefault ? { isDefault: true } : undefined,
  }));

  // If freeform is allowed, add a reply action so user can type custom input
  if (freeformAllowed) {
    actions.push({ label: 'Reply', action: 'reply' });
  }

  // Always include an "Open" action to jump to the terminal
  actions.push({ label: 'Open', action: 'open' });

  return actions;
}

// Map LLM classifications to notification types and session status
function mapClassificationToNotification(
  classifications: NotificationClassification[],
  options: ParsedOption[],
  freeformAllowed: boolean,
): {
  notificationType: NotificationType;
  sessionStatus: 'active' | 'waiting_input' | 'paused' | 'terminated';
  priority: 'low' | 'normal' | 'high';
  actions: NotificationAction[];
} {
  // Priority: question > permission > error > task_complete > progress_update > idle
  if (classifications.includes('question')) {
    return {
      notificationType: 'user_input_required',
      sessionStatus: 'waiting_input',
      priority: 'high',
      actions: optionsToActions(options, freeformAllowed),
    };
  }

  if (classifications.includes('permission')) {
    return {
      notificationType: 'permission_request',
      sessionStatus: 'waiting_input',
      priority: 'high',
      actions: optionsToActions(options, false), // Permissions are pick-one, no freeform
    };
  }

  if (classifications.includes('error')) {
    return {
      notificationType: 'error',
      sessionStatus: 'waiting_input',
      priority: 'high',
      actions: optionsToActions(options, true), // Errors always allow freeform reply
    };
  }

  if (classifications.includes('task_complete')) {
    return {
      notificationType: 'task_complete',
      sessionStatus: 'terminated',
      priority: 'normal',
      actions: [{ label: 'View', action: 'view' }],
    };
  }

  // progress_update or idle — low priority
  return {
    notificationType: 'task_complete',
    sessionStatus: 'terminated',
    priority: 'low',
    actions: [{ label: 'View', action: 'view' }],
  };
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

  // Hook callback for task completion (Stop event) — uses LLM classifier
  .post('/hooks/complete', async ({ body, set }) => {
    console.log('hooks/complete', body);
    const session = await getSessionWithProject(body.sessionId);

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Parse transcript for summary if available
    let transcriptInfo: { stopReason?: string; summary?: string } = {};
    if (body.transcript_path) {
      transcriptInfo = await getTranscriptSummary(body.transcript_path);
    }

    const messageText = body.last_assistant_message || transcriptInfo.summary || body.prompt || 'Task completed';

    // Classify the message using LLM engine
    const classification = await notificationClassifier.classify({
      message: messageText,
      hookEvent: body.hook_event_name || 'Stop',
      stopReason: transcriptInfo.stopReason,
      transcriptSummary: transcriptInfo.summary,
    });

    console.log('[hooks/complete] Classification:', classification);

    // Map classifications to notification type and session status
    const { notificationType, sessionStatus, priority, actions } =
      mapClassificationToNotification(
        classification.classifications,
        classification.options,
        classification.freeformAllowed,
      );

    // Update session status based on classification
    await db.update(claudeSessions)
      .set({ status: sessionStatus })
      .where(eq(claudeSessions.id, body.sessionId));

    // Dismiss pending notifications if task is actually complete
    if (classification.classifications.includes('task_complete') && !classification.requiresUserAction) {
      await notificationService.dismissBySession(body.sessionId);
    }

    // Build notification body — prefer classifier summary
    let notificationBody = classification.summary || messageText;
    if (transcriptInfo.stopReason && transcriptInfo.stopReason !== 'end_turn') {
      notificationBody = `[${transcriptInfo.stopReason}] ${notificationBody}`;
    }

    // Build title with project name
    const titleMap: Record<string, string> = {
      user_input_required: 'Question',
      permission_request: 'Permission Request',
      task_complete: 'Task Complete',
      error: 'Error',
    };
    const baseTitle = titleMap[notificationType] || 'Update';
    const title = session.projectName ? `${session.projectName}: ${baseTitle}` : baseTitle;

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: notificationType,
      title,
      body: notificationBody,
      actions,
      priority,
      metadata: {
        ...(session.projectName ? { projectName: session.projectName } : {}),
        ...(transcriptInfo.stopReason ? { stopReason: transcriptInfo.stopReason } : {}),
        classifications: classification.classifications,
        classificationConfidence: classification.confidence,
        options: classification.options,
        freeformAllowed: classification.freeformAllowed,
      },
    });

    return {
      success: true,
      notificationId: result.notification.id,
      notification: result.sendResult,
      classification,
    };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      type: t.Optional(t.String()),
      prompt: t.Optional(t.String()),
      // Fields from Claude CLI hooks
      last_assistant_message: t.Optional(t.String()),
      transcript_path: t.Optional(t.String()),
      session_id: t.Optional(t.String()),
      stop_hook_active: t.Optional(t.Boolean()),
      cwd: t.Optional(t.String()),
      permission_mode: t.Optional(t.String()),
      hook_event_name: t.Optional(t.String()),
    }),
  });
