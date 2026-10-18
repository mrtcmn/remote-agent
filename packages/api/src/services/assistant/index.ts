import { randomBytes } from 'node:crypto';

/**
 * The operator: a Haiku-backed Claude Code run that sees every session through
 * the remote-agent MCP tools and answers like a senior teammate — short, spoken.
 *
 * Each turn is one `claude -p` process; `--resume` carries the conversation.
 * The MCP tools are served in-process over HTTP (see assistant.routes.ts), so
 * this works from the compiled binary too, where mcp-server.ts is not on disk.
 */

/** Guards the in-process MCP endpoint; only the claude child we spawn knows it. */
export const MCP_SECRET = randomBytes(24).toString('hex');
export const MCP_SECRET_HEADER = 'x-assistant-secret';

const SYSTEM_PROMPT = `You are the operator of remote-agent: a senior engineer on the user's team who watches every coding-agent session, run, flow and kanban task through the remote-agent tools.

Your reply is spoken aloud by a text-to-speech voice. So:
- Reply in the language the user spoke or wrote (Turkish in, Turkish out). Speech-to-text input can be messy, with fillers and missing apostrophes; read through that.
- Talk like a calm senior dev giving a quick status in standup. Plain sentences, no markdown, no lists, no code, no ids, no URLs.
- Default to 1-3 short sentences. Lead with the verdict ("It's done and deployed." / "It's stuck on a failing test."), then only what matters.
- Agents write long explanations; compress them hard. Mention a recommendation only if it is worth acting on, in a few words.
- When asked about a session, find it (list_sessions: newest first; match the project the user names loosely, "remote agent" = remote-agent), read it (show_session), and summarize what actually happened lately. If nothing is running, check finished ones with all=true before saying there is none. Identify sessions by project or branch name, never by id.
- You can act: send prompts to agents, open/close sessions, start runs and flows, create/update/comment tasks. For anything destructive (closing a session, deleting), confirm first unless the user clearly asked.
- After send_prompt or open_session you are told automatically when that agent finishes or needs the user (a message starting with "[agent update]"). So say you'll report back when it's done — never promise "a few seconds". On an [agent update], read the session (show_session) and report what the agent concluded, briefly.
- If a tool fails, say so in one sentence. Do not guess state you did not read.
- list_tasks without a filter can return a huge payload: always pass status and/or projectId.
- If you already know the answer from the conversation, answer without calling tools.`;

export type AssistantEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'step'; id: string; tool: string; input: unknown }
  | { type: 'step_done'; id: string; ok: boolean; output: string }
  | { type: 'text'; text: string }
  | { type: 'done'; text: string; sessionId?: string }
  | { type: 'error'; message: string };

const MODEL = () => process.env.ASSISTANT_MODEL || 'haiku';

/** Claude tool names arrive as mcp__ra__list_sessions; the UI wants list_sessions. */
const shortTool = (name: string) => name.replace(/^mcp__ra__/, '');

/** Cap tool output we echo to the UI; the model already saw the full thing. */
const clip = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}…` : s);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join('');
  return '';
}

/** Map one stream-json line from `claude -p` to zero or more UI events. */
export function mapStreamLine(line: any): AssistantEvent[] {
  if (line.type === 'system' && line.subtype === 'init' && line.session_id) {
    return [{ type: 'session', sessionId: line.session_id }];
  }
  if (line.type === 'assistant') {
    const out: AssistantEvent[] = [];
    for (const block of line.message?.content ?? []) {
      if (block.type === 'tool_use') out.push({ type: 'step', id: block.id, tool: shortTool(block.name), input: block.input });
      else if (block.type === 'text' && block.text?.trim()) out.push({ type: 'text', text: block.text });
    }
    return out;
  }
  if (line.type === 'user') {
    return (line.message?.content ?? [])
      .filter((b: any) => b.type === 'tool_result')
      .map((b: any) => ({ type: 'step_done', id: b.tool_use_id, ok: !b.is_error, output: clip(resultText(b.content)) }));
  }
  if (line.type === 'result') {
    if (line.is_error) return [{ type: 'error', message: line.result || line.subtype || 'Assistant failed' }];
    return [{ type: 'done', text: line.result ?? '', sessionId: line.session_id }];
  }
  return [];
}

/** Tools that hand an agent work; when one succeeds, its target is worth watching. */
export function handoffTarget(tool: string, input: any, output: string): { sessionId?: string; terminalId?: string; machine?: string } | null {
  if (tool === 'send_prompt') return { terminalId: input?.terminalId, machine: input?.machine };
  if (tool === 'open_session') {
    try {
      const o = JSON.parse(output);
      return { sessionId: o.sessionId, terminalId: o.terminalId, machine: input?.machine };
    } catch {
      return null;
    }
  }
  return null;
}

export async function* ask(opts: {
  text: string;
  resume?: string;
  mcpUrl: string;
  /** Called when the operator hands an agent work, so the caller can watch for the result. */
  onHandoff?: (target: { sessionId?: string; terminalId?: string; machine?: string }) => void;
}): AsyncGenerator<AssistantEvent> {
  const mcpConfig = JSON.stringify({
    mcpServers: { ra: { type: 'http', url: opts.mcpUrl, headers: { [MCP_SECRET_HEADER]: MCP_SECRET } } },
  });
  const args = [
    process.env.CLAUDE_BIN_PATH || 'claude',
    '-p',
    '--model', MODEL(),
    '--output-format', 'stream-json',
    '--verbose',
    '--system-prompt', SYSTEM_PROMPT,
    '--mcp-config', mcpConfig,
    '--strict-mcp-config',
    '--allowedTools', 'mcp__ra',
    // No Bash/Edit/Read: the operator only acts through remote-agent.
    '--tools', '',
    ...(opts.resume ? ['--resume', opts.resume] : []),
  ];

  const proc = Bun.spawn(args, {
    stdin: new TextEncoder().encode(opts.text),
    stdout: 'pipe',
    stderr: 'pipe',
    // REMOTE_AGENT_CLASSIFIER keeps our own hooks from treating this as a session.
    env: { ...(process.env as Record<string, string>), REMOTE_AGENT_CLASSIFIER: '1' },
  });
  const stderr = new Response(proc.stderr).text();

  let finished = false;
  const steps = new Map<string, { tool: string; input: unknown }>();
  try {
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!raw) continue;
        let line: unknown;
        try { line = JSON.parse(raw); } catch { continue; }
        for (const ev of mapStreamLine(line)) {
          if (ev.type === 'done' || ev.type === 'error') finished = true;
          if (ev.type === 'step') steps.set(ev.id, { tool: ev.tool, input: ev.input });
          if (ev.type === 'step_done' && ev.ok && opts.onHandoff) {
            const step = steps.get(ev.id);
            const target = step && handoffTarget(step.tool, step.input, ev.output);
            if (target) opts.onHandoff(target);
          }
          yield ev;
        }
      }
    }
    await proc.exited;
    if (!finished) yield { type: 'error', message: (await stderr).trim().slice(0, 500) || `claude exited ${proc.exitCode}` };
  } finally {
    // Client hung up mid-turn: don't leave the agent running on its own.
    if (proc.exitCode === null) proc.kill();
  }
}
