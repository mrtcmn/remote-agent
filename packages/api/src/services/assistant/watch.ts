import { EventEmitter } from 'node:events';
import { call } from '../../mcp-server';

/**
 * "I'll report back when it's done": after the operator hands an agent work
 * (send_prompt / open_session), watch that terminal for the Claude Code hook
 * notification that says it finished or needs the user, and tell the UI.
 *
 * ponytail: polls the target machine's /notifications (one path for local and
 * remote — live push only exists for local). Upgrade to the local emitter plus
 * a remote push if 4s of latency ever matters.
 */

export interface AgentUpdate {
  type: 'agent_update';
  kind: string;
  sessionId: string;
  terminalId?: string;
  machine?: string;
  project?: string;
  title: string;
  body: string;
}

/** Emits `AgentUpdate` on the channel named by the user's id. */
export const watchEvents = new EventEmitter();
watchEvents.setMaxListeners(0);

/** Hook outcomes worth interrupting the user for; "working" cards are not. */
const DONE_TYPES = new Set(['task_complete', 'user_input_required', 'permission_request', 'error']);
const POLL_MS = 4000;
const MAX_MS = 20 * 60_000;

const active = new Set<string>();

interface Target {
  sessionId?: string;
  terminalId?: string;
  machine?: string;
}

async function recent(t: Target): Promise<any[]> {
  const q = t.sessionId ? `sessionId=${encodeURIComponent(t.sessionId)}&limit=20` : 'limit=30';
  const data = await call('GET', `/notifications?${q}`, undefined, t.machine);
  return data?.notifications ?? [];
}

/** True if this notification belongs to the watched agent. */
export function matches(n: any, t: Target): boolean {
  if (!DONE_TYPES.has(n.type)) return false;
  if (t.terminalId && n.terminalId) return n.terminalId === t.terminalId;
  return !!t.sessionId && n.sessionId === t.sessionId;
}

export async function watchAgent(userId: string, t: Target): Promise<void> {
  if (!t.terminalId && !t.sessionId) return;
  const key = `${t.machine ?? 'self'}:${t.terminalId ?? t.sessionId}`;
  if (active.has(key)) return;
  active.add(key);

  try {
    // Whatever already exists is history, not this task's answer.
    const seen = new Set((await recent(t)).map((n) => n.id));
    const started = Date.now();
    void (async () => {
      try {
        while (Date.now() - started < MAX_MS) {
          await Bun.sleep(POLL_MS);
          const hit = (await recent(t).catch(() => [])).find((n) => !seen.has(n.id) && matches(n, t));
          if (!hit) continue;
          const update: AgentUpdate = {
            type: 'agent_update',
            kind: hit.type,
            sessionId: hit.sessionId,
            terminalId: hit.terminalId ?? t.terminalId,
            machine: t.machine,
            project: hit.metadata?.projectName ?? hit.projectName,
            title: hit.title ?? '',
            body: hit.body ?? '',
          };
          watchEvents.emit(userId, update);
          return;
        }
      } finally {
        active.delete(key);
      }
    })();
  } catch (err) {
    active.delete(key);
    console.warn('[assistant] watch failed', key, (err as Error).message);
  }
}
