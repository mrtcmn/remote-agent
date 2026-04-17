import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { db, claudeSessions, projects } from '../db';
import { notificationService } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';
import { notificationClassifier } from '../services/notification/classifier';
import { artifactService } from '../services/artifact';
import { getProjectCredentialsById } from '../services/git';
import type { NotificationClassification, ParsedOption, ClassificationResult } from '../services/notification/classifier';

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

interface AskUserQuestion {
  question: string;
  header?: string;
  options?: { label: string; description?: string; value?: string }[];
  multiSelect?: boolean;
}

interface TranscriptInfo {
  stopReason?: string;
  summary?: string;
  // Extracted from AskUserQuestion tool calls
  askQuestion?: AskUserQuestion;
}

// Helper to parse transcript and get summary + structured tool calls
async function getTranscriptSummary(transcriptPath: string): Promise<TranscriptInfo> {
  try {
    const expandedPath = transcriptPath.replace(/^~/, process.env.HOME || '');
    const content = await readFile(expandedPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse JSONL - scan last 20 entries
    const entries = lines.slice(-20).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    let stopReason: string | undefined;
    let summary: string | undefined;
    let askQuestion: AskUserQuestion | undefined;

    for (const entry of [...entries].reverse()) {
      if (entry.stop_reason && !stopReason) {
        stopReason = entry.stop_reason;
      }

      if (entry.type === 'assistant' && entry.message?.content && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          // Extract AskUserQuestion tool calls — these have structured options
          if (!askQuestion && block.type === 'tool_use' && block.name === 'AskUserQuestion') {
            const questions: AskUserQuestion[] = block.input?.questions ?? [];
            if (questions.length > 0) {
              askQuestion = questions[0];
            }
          }

          // Extract last text summary from assistant
          if (!summary && block.type === 'text' && block.text) {
            summary = block.text.slice(0, 200);
            if (block.text.length > 200) summary += '...';
          }
        }
      }

      if (stopReason && summary && askQuestion) break;
    }

    return { stopReason, summary, askQuestion };
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
    console.log('hooks/attention raw body:', JSON.stringify(body, null, 2));
    const session = await getSessionWithProject(body.sessionId);

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Parse transcript for the actual last assistant message
    let transcriptInfo: TranscriptInfo = {};
    const transcriptPath = (body as Record<string, unknown>).transcript_path as string | undefined;
    if (transcriptPath) {
      transcriptInfo = await getTranscriptSummary(transcriptPath);
    }

    const hookType = (body as Record<string, unknown>).notification_type as string || body.type || 'idle_prompt';
    const messageText = transcriptInfo.summary || body.message || body.prompt || 'Attention required';
    console.log('[hooks/attention] hookType:', hookType, '| askQuestion:', transcriptInfo.askQuestion, '| summary:', transcriptInfo.summary);

    let classification: ClassificationResult;

    if (transcriptInfo.askQuestion) {
      // AskUserQuestion found in transcript — use its structured data directly, skip LLM
      const q = transcriptInfo.askQuestion;
      const parsedOptions: ParsedOption[] = (q.options ?? []).map(o => ({
        label: o.label,
        value: o.value ?? o.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      }));
      classification = {
        classifications: ['question'],
        confidence: 1,
        summary: q.header ? `${q.header}: ${q.question}` : q.question,
        requiresUserAction: true,
        options: parsedOptions,
        freeformAllowed: q.multiSelect ?? false,
      };
      console.log('[hooks/attention] Used AskUserQuestion directly:', classification);
    } else {
      // Fall back to LLM classification
      classification = await notificationClassifier.classify({ message: messageText, hookEvent: hookType });
      console.log('[hooks/attention] LLM Classification:', classification);
    }

    // Map to notification type
    const notificationType: NotificationType = hookType === 'permission_prompt' || classification.classifications.includes('permission')
      ? 'permission_request'
      : 'user_input_required';

    const actions = classification.options.length > 0 || classification.freeformAllowed
      ? optionsToActions(classification.options, classification.freeformAllowed)
      : notificationType === 'permission_request'
        ? [{ label: 'Approve', action: 'approve' }, { label: 'Deny', action: 'deny' }]
        : [{ label: 'Open', action: 'open' }, { label: 'Reply', action: 'reply' }];

    // Update session status
    await db.update(claudeSessions)
      .set({ status: 'waiting_input' })
      .where(eq(claudeSessions.id, body.sessionId));

    const titleMap: Record<string, string> = {
      user_input_required: 'Question',
      permission_request: 'Permission Request',
    };
    const baseTitle = titleMap[notificationType] || 'Attention Required';
    const title = session.projectName ? `${session.projectName}: ${baseTitle}` : baseTitle;

    const notificationBody = classification.summary || messageText;

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: notificationType,
      title,
      body: notificationBody,
      actions,
      priority: 'high',
      metadata: {
        ...(session.projectName ? { projectName: session.projectName } : {}),
        classifications: classification.classifications,
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
      notification_type: t.Optional(t.String()),
      prompt: t.Optional(t.String()),
      // Fields from Claude CLI hooks
      message: t.Optional(t.String()),
      session_id: t.Optional(t.String()),
      transcript_path: t.Optional(t.String()),
      hook_event_name: t.Optional(t.String()),
    }, { additionalProperties: true }),
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
    }, { additionalProperties: true }),
  })

  // Hook callback for PostToolUse — captures artifacts from tool outputs
  .post('/hooks/artifact', async ({ body, set }) => {
    console.log('hooks/artifact', body.tool_name);

    const session = await getSessionWithProject(body.sessionId);
    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const toolInput = typeof body.tool_input === 'string'
      ? (() => { try { return JSON.parse(body.tool_input); } catch { return {}; } })()
      : (body.tool_input || {});

    const result = await artifactService.processToolOutput({
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      toolName: body.tool_name || '',
      toolInput,
      toolResult: body.tool_result || '',
    });

    if (!result) {
      return { success: false, message: 'No adapter matched or processing failed' };
    }

    return { success: true, artifact: result };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      tool_name: t.Optional(t.String()),
      tool_input: t.Optional(t.Any()),
      tool_result: t.Optional(t.String()),
    }, { additionalProperties: true }),
  })

  // Git credential helper endpoint — returns fresh GitHub App tokens for shell git commands
  .get('/git-credential/:projectId', async ({ params, set }) => {
    try {
      const creds = await getProjectCredentialsById(params.projectId);
      if (!creds) {
        set.status = 404;
        return { error: 'No credentials found for project' };
      }
      return creds;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ projectId: t.String() }),
  });
