import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, claudeSessions, projects, terminals } from '../db';
import { notificationService, notificationRepository } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';
import { notificationClassifier } from '../services/notification/classifier';
import { artifactService } from '../services/artifact';
import { getProjectCredentialsById } from '../services/git';
import type { NotificationClassification, ParsedOption, ClassificationResult } from '../services/notification/classifier';
import { getTranscriptSummary, describeTool, type TranscriptInfo } from './hooks.helpers';
import { taskLoopService } from '../services/kanban';
import type { AgentSignal } from '../services/kanban/task-loop.service';

/** Tells the board what the session's agent is doing. Off the hook's path. */
function signalTasks(sessionId: string, signal: AgentSignal) {
  taskLoopService.onSessionSignal(sessionId, signal).catch(err => {
    console.error('[hooks] task loop signal failed:', err);
  });
}

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

async function getTerminalName(terminalId: string | undefined): Promise<string | null> {
  if (!terminalId) return null;
  try {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, terminalId),
      columns: { name: true, command: true },
    });
    if (!terminal) return null;
    if (terminal.name && terminal.name !== 'Terminal') return terminal.name;
    // Fall back to the shell binary name from the command array
    const cmd = JSON.parse(terminal.command) as string[];
    const bin = cmd[0]?.split('/').pop();
    return bin || terminal.name;
  } catch {
    return null;
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
    // Feed the classifier the FULL assistant text, not the 200-char summary — the
    // real choices usually sit at the end of the message and were being cut off.
    const messageText = transcriptInfo.fullText || transcriptInfo.summary || body.message || body.prompt || 'Attention required';
    console.log('[hooks/attention] hookType:', hookType, '| askQuestion:', transcriptInfo.askQuestion, '| summary:', transcriptInfo.summary);

    let classification: ClassificationResult;
    // metadata.questions — ALL questions from the AskUserQuestion block, so a
    // client (and the multi-answer respond path) can render/replay each one.
    // undefined on the LLM fallback path. questions.length is the "N questions" hint.
    let questionsMeta:
      | { question: string; header?: string; multiSelect?: boolean; options: { label: string; value: string }[] }[]
      | undefined;

    if (transcriptInfo.askQuestion) {
      // AskUserQuestion found in transcript — use its structured data directly, skip LLM
      const q = transcriptInfo.askQuestion;
      const parsedOptions: ParsedOption[] = (q.options ?? []).map(o => ({
        label: o.label,
        value: o.value ?? o.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      }));
      // Derive value EXACTLY as the single-question code above does.
      questionsMeta = (transcriptInfo.askQuestions ?? [q]).map(qq => ({
        question: qq.question,
        ...(qq.header ? { header: qq.header } : {}),
        ...(qq.multiSelect !== undefined ? { multiSelect: qq.multiSelect } : {}),
        options: (qq.options ?? []).map(o => ({
          label: o.label,
          value: o.value ?? o.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        })),
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

    // Trust the classifier for the type, with two guards:
    //  • a permission_prompt is always a permission request (yes/no).
    //  • an idle_prompt that's only progress/idle is NOT actionable — the agent is
    //    still working, so show it as in-progress (blue), never a fake "needs you".
    const forcePermission = hookType === 'permission_prompt';
    const rawCls = classification.classifications;
    // The classifier sometimes mislabels a choice as progress_update/idle while STILL
    // extracting the real options. Options present = Claude is waiting on a pick = a
    // question, not "working". Fold that in (unless it's a completion → "what's next?").
    const cls: NotificationClassification[] =
      classification.options.length > 0
        && !rawCls.includes('question') && !rawCls.includes('task_complete')
        ? [...rawCls, 'question']
        : rawCls;
    const actionable = forcePermission
      || cls.includes('question') || cls.includes('permission') || cls.includes('error');
    const mapped = mapClassificationToNotification(cls, classification.options, classification.freeformAllowed);

    // "Done, with a follow-up question" reads as DONE, not "needs you": the work is
    // finished and the question is just an optional "what's next?". So task_complete
    // wins the status over a co-occurring question — its options stay on the record
    // (in metadata/actions) for the client to show under a "What's next?" section.
    // error / permission still outrank it.
    const completeWithFollowup = cls.includes('task_complete')
      && !cls.includes('error') && !cls.includes('permission') && !forcePermission;

    // A live background workflow means the main turn going idle is NOT a real
    // completion — the workflow keeps running and notifies on its own. Show it as
    // working (blue), never a fake "done". Actionable prompts (a genuine
    // question/permission/error from the main agent) still win — the user must act.
    const workflowPending = transcriptInfo.workflowPending === true;
    const notificationType: NotificationType = forcePermission
      ? 'permission_request'
      : actionable
        ? (completeWithFollowup ? 'task_complete' : mapped.notificationType)
        : workflowPending
          ? 'session_started'
          // idle_prompt fires only when Claude has STOPPED and is waiting — it's
          // never "working" (that comes solely from PreToolUse → /active or a live
          // workflow above). So a non-actionable idle prompt = idle/done, shown green.
          : 'task_complete';
    const needsInput = notificationType === 'user_input_required'
      || notificationType === 'permission_request'
      || notificationType === 'error';
    if (notificationType === 'task_complete') signalTasks(body.sessionId, 'done');

    // Real options → real buttons. A genuine permission with no parsed options → Approve/Deny
    // (a permission IS yes/no). Otherwise DO NOT fabricate choices — just an Open action so
    // the client can jump to the terminal ("respond there"). No fake approve/deny.
    const actions = classification.options.length > 0 || classification.freeformAllowed
      ? optionsToActions(classification.options, classification.freeformAllowed)
      : notificationType === 'permission_request'
        ? [{ label: 'Approve', action: 'approve' }, { label: 'Deny', action: 'deny' }]
        : [{ label: 'Open', action: 'open' }];

    // Only mark the session as waiting when it actually needs the user; a completion
    // stays 'active' (alive, idle) rather than a stale "waiting for input".
    await db.update(claudeSessions)
      .set({ status: needsInput ? 'waiting_input' : 'active' })
      .where(eq(claudeSessions.id, body.sessionId));

    const titleMap: Record<string, string> = {
      user_input_required: 'Question',
      permission_request: 'Permission Request',
      task_complete: 'Task Complete',
      error: 'Error',
      session_started: 'Working',
    };
    const baseTitle = titleMap[notificationType] || 'Attention Required';
    const title = session.projectName ? `${session.projectName}: ${baseTitle}` : baseTitle;

    // Use the concise classifier recap (2-3 sentences) as the body, not the full transcript
    const notificationBody = classification.summary || messageText;
    const terminalName = await getTerminalName(body.terminalId);

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: notificationType,
      title,
      body: notificationBody,
      actions,
      priority: forcePermission ? 'high' : mapped.priority,
      metadata: {
        ...(session.projectName ? { projectName: session.projectName } : {}),
        ...(terminalName ? { terminalName } : {}),
        classifications: classification.classifications,
        // metadata.options stays pointed at the FIRST question (backward compat);
        // metadata.questions carries all N for multi-question clients.
        options: classification.options,
        freeformAllowed: classification.freeformAllowed,
        // interactive=true only when the options came from a real AskUserQuestion
        // selector on screen (arrow-drivable). On the LLM-inferred path there's no
        // selector — the respond path must TYPE the chosen label instead.
        interactive: !!transcriptInfo.askQuestion,
        ...(questionsMeta ? { questions: questionsMeta } : {}),
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
    let transcriptInfo: TranscriptInfo = {};
    if (body.transcript_path) {
      transcriptInfo = await getTranscriptSummary(body.transcript_path);
    }

    // Carry startedAt from the working card we're about to supersede, so the "done"
    // card can show how long the task took (frozen at completion).
    const prevLive = body.terminalId ? await notificationRepository.latestLiveForTerminal(body.terminalId) : null;
    const startedAt = (prevLive?.metadata as Record<string, unknown> | undefined)?.startedAt;

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
    if (notificationType === 'task_complete') signalTasks(body.sessionId, 'done');

    // Dismiss pending notifications if task is actually complete
    if (classification.classifications.includes('task_complete') && !classification.requiresUserAction) {
      await notificationService.dismissBySession(body.sessionId);
    }

    // Use the concise classifier recap (2-3 sentences) as the body, not the full transcript
    let notificationBody = classification.summary || body.last_assistant_message || messageText;
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
    const terminalName = await getTerminalName(body.terminalId);

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
        ...(terminalName ? { terminalName } : {}),
        ...(transcriptInfo.stopReason ? { stopReason: transcriptInfo.stopReason } : {}),
        ...(transcriptInfo.model ? { model: transcriptInfo.model } : {}),
        ...(transcriptInfo.todosTotal ? { todosDone: transcriptInfo.todosDone ?? 0, todosTotal: transcriptInfo.todosTotal } : {}),
        ...(startedAt ? { startedAt } : {}),
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

  // Hook callback for UserPromptSubmit + PreToolUse — the agent is working again.
  // Flips the terminal's live notification to "in-progress", which supersedes any
  // pending needs-you (the user just answered) or leftover done.
  .post('/hooks/active', async ({ body, set }) => {
    const session = await getSessionWithProject(body.sessionId);
    if (!session) { set.status = 404; return { error: 'Session not found' }; }
    if (!body.terminalId) return { success: true, skipped: 'no terminal' };

    await db.update(claudeSessions)
      .set({ status: 'active' })
      .where(eq(claudeSessions.id, body.sessionId));
    signalTasks(body.sessionId, 'working');

    // Live detail for the session card. currentTool is free (in the PreToolUse
    // payload); model/todos/context come from a last-20-line transcript parse.
    // ponytail: that parse runs per tool call — cheap (bounded read) and this is a
    // local single-user tool; add a per-terminal throttle only if it shows up hot.
    const activity = describeTool(body.tool_name, body.tool_input);
    const metrics: TranscriptInfo = body.transcript_path ? await getTranscriptSummary(body.transcript_path) : {};
    const liveMeta: Record<string, unknown> = {
      ...(session.projectName ? { projectName: session.projectName } : {}),
      ...(activity ? { activity } : {}),
      ...(metrics.model ? { model: metrics.model } : {}),
      ...(metrics.todosTotal ? { todosDone: metrics.todosDone ?? 0, todosTotal: metrics.todosTotal } : {}),
      ...(metrics.contextPct !== undefined ? { contextPct: metrics.contextPct } : {}),
      lastActiveAt: new Date().toISOString(),
    };

    // PreToolUse fires on every tool call. If we're already showing "working" for
    // this terminal, patch the live card's detail in place (no new row, no push
    // popup — running updates are silent on the notch) rather than re-create it.
    const latest = await notificationRepository.latestLiveForTerminal(body.terminalId);
    if (latest?.type === 'session_started') {
      await notificationService.patchMetadata(latest.id, liveMeta);
      return { success: true, updated: latest.id };
    }

    // First tool of a fresh turn → create the working card and stamp startedAt so
    // the card (and the later "done" card) can show elapsed.
    const terminalName = await getTerminalName(body.terminalId);
    const title = session.projectName ? `${session.projectName}: Working` : 'Working';
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: 'session_started', // maps to the running/blue "working" status in clients
      title,
      body: 'Working…',
      actions: [{ label: 'Open', action: 'open' }],
      priority: 'low',
      metadata: {
        ...liveMeta,
        ...(terminalName ? { terminalName } : {}),
        startedAt: new Date().toISOString(),
      },
    });

    return { success: true, notificationId: result.notification.id };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      session_id: t.Optional(t.String()),
      transcript_path: t.Optional(t.String()),
      hook_event_name: t.Optional(t.String()),
      prompt: t.Optional(t.String()),
      tool_name: t.Optional(t.String()),
      tool_input: t.Optional(t.Any()),
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
