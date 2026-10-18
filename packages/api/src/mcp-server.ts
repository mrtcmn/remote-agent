#!/usr/bin/env bun
/**
 * Stdio MCP server exposing remote-agent — this machine and every machine it is
 * paired with — to any MCP client:
 *
 *   claude mcp add remote-agent -- bun run <repo>/packages/api/src/mcp-server.ts
 *
 * Env: RA_URL (else REMOTE_AGENT_API, which every remote-agent session exports;
 * else the local API is probed for on its usual ports), RA_TOKEN (a
 * machine token; without one it signs in as the seeded local user), RA_EMAIL /
 * RA_PASSWORD to override those credentials.
 *
 * It speaks to the HTTP API only — nothing is imported from the server — so it
 * runs beside the API or against a remote one. Cross-machine reach is the
 * `X-Machine-Id` header the UI already uses (`x-target-machine-id` with a
 * machine token): the local API forwards the request over whichever transport
 * that machine is on, so every tool below gets "works on any paired machine"
 * from one `machine` argument.
 *
 * ponytail: hand-rolled JSON-RPC. The official SDK pulls express+hono+ajv (116
 * packages) to frame newline-delimited JSON on stdio; swap it in if we ever need
 * resources, prompts, or sampling.
 */
import { userInfo } from 'node:os';

const VERSION = '1.0.0';
/** Protocol revision we implement; we echo the client's if it asks for another. */
const PROTOCOL = '2025-06-18';

// ─── HTTP plumbing ────────────────────────────────────────────────────────────

/** Installed app, then the dev port, then the docker/compose default.
 *  Set RA_URL or RA_PORT to pin one when both the app and dev run. */
const CANDIDATE_PORTS = [process.env.RA_PORT, process.env.PORT, '13590', '13690', '5100'].filter(Boolean);

let baseUrl: string | null =
  (process.env.RA_URL ?? process.env.REMOTE_AGENT_API)?.replace(/\/+$/, '') ?? null;

/** Pin the API address (the in-process HTTP transport points it at its own server). */
export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/+$/, '');
}

/** Where the API is. Probed once, because the port differs per install mode. */
async function base(): Promise<string> {
  if (baseUrl) return baseUrl;
  for (const port of CANDIDATE_PORTS) {
    const url = `http://localhost:${port}`;
    const up = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.ok)
      .catch(() => false);
    if (up) return (baseUrl = url);
  }
  throw new Error(
    `No remote-agent API answered on ports ${CANDIDATE_PORTS.join(', ')}. Set RA_URL.`,
  );
}

let cookie: string | null = null;

async function signIn(): Promise<string> {
  const email = process.env.RA_EMAIL || `${userInfo().username}@local.machine`;
  const password = process.env.RA_PASSWORD || 'local-mode';
  const res = await fetch(`${await base()}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(
      `Sign-in as ${email} failed (HTTP ${res.status}). Set RA_TOKEN to a machine token, or RA_EMAIL/RA_PASSWORD.`,
    );
  }
  const jar = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!jar) throw new Error('Sign-in returned no session cookie');
  return jar;
}

/** One request to the remote-agent API, optionally relayed to another machine. */
export async function call(
  method: string,
  path: string,
  body?: unknown,
  machine?: string,
): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.RA_TOKEN) headers.authorization = `Bearer ${process.env.RA_TOKEN}`;
  else headers.cookie = (cookie ??= await signIn());

  const machineId = await resolveMachineId(machine);
  // A cookie session goes through the machine proxy (X-Machine-Id), which
  // reaches every transport: paired masters, tunnelled secondaries, relayed
  // peers. The relay header only knows our own secondaries — a paired master
  // 404s there — but it is the one a machine token may use.
  if (machineId) headers[process.env.RA_TOKEN ? 'x-target-machine-id' : 'x-machine-id'] = machineId;

  const root = await base();
  const send = () =>
    fetch(`${root}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send();
  // Session cookies expire; a machine token does not, so only retry the former.
  if (res.status === 401 && !process.env.RA_TOKEN) {
    headers.cookie = cookie = await signIn();
    res = await send();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'error' in data
      ? (data as any).error
      : text.slice(0, 200);
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${detail}`);
  }
  // The server serves its SPA on unknown paths, so a missing route arrives as
  // 200 text/html. Without this check the tool would quietly return nothing.
  if (text && !(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(
      `${method} ${path} → HTTP ${res.status} answered with HTML, not JSON. ${root} is probably running a build without this route (or a proxy answered).`,
    );
  }
  return data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── Machines ─────────────────────────────────────────────────────────────────

type MachineRow = { machineId: string; machineName: string; online: boolean; error?: string };

let machineCache: MachineRow[] | null = null;

async function listMachines(): Promise<MachineRow[]> {
  // The aggregate endpoint is the one place that already knows every transport.
  const data = await call('GET', '/sessions/sidebar/aggregate');
  return (data.machines ?? []).map((m: any) => ({
    machineId: m.machineId,
    machineName: m.machineName,
    online: m.online,
    ...(m.error ? { error: m.error } : {}),
  }));
}

/** Accepts an id or a display name; returns null for "this machine" (no header). */
export async function resolveMachineId(machine?: string): Promise<string | null> {
  if (!machine || machine === 'self' || machine === 'local') return null;
  const rows = (machineCache ??= await listMachines());
  const hit =
    rows.find((m) => m.machineId === machine) ??
    rows.find((m) => m.machineName.toLowerCase() === machine.toLowerCase());
  if (!hit) {
    throw new Error(
      `Unknown machine "${machine}". Known: ${rows.map((m) => `${m.machineName} (${m.machineId})`).join(', ') || 'none'}`,
    );
  }
  return hit.machineId === 'self' ? null : hit.machineId;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

/** Field name → [JSON Schema type, description]. Shared because they repeat. */
const FIELDS: Record<string, [string, string]> = {
  machine: ['string', 'Machine id or name from list_machines. Omit for this machine.'],
  sessionId: ['string', 'Session id.'],
  terminalId: ['string', 'Terminal id, from show_session.'],
  projectId: ['string', 'Project id, from list_projects.'],
  prompt: ['string', 'Prompt text to send to the agent.'],
  agent: ['string', 'Agent CLI to launch: claude (default), opencode, or kimi.'],
  lines: ['number', 'Trailing output lines to return per terminal (default 120).'],
  all: ['boolean', 'Include finished sessions, not just running ones.'],
  limit: ['number', 'Max sessions per machine, newest first (default 20).'],
  env: ['object', 'Complete {NAME: value} map. This REPLACES the stored one — include every var you want to keep.'],
  name: ['string', 'Display name.'],
  runId: ['string', 'Run config id, from list_runs.'],
  flowId: ['string', 'Run flow id, from list_flows.'],
  adapterType: ['string', 'npm_script (default), custom_command, or browser_preview.'],
  command: ['object', 'Adapter command: {"script":"dev"} for npm_script, {"command":"make run"} for custom_command.'],
  cwd: ['string', 'Working directory for the process, relative to the project root.'],
  autoRestart: ['boolean', 'Restart the process when it exits.'],
  patch: ['object', 'Fields to change, e.g. {"name":"dev","autoRestart":true}.'],
  taskId: ['string', 'Kanban task id, from list_tasks.'],
  title: ['string', 'Task title — one line, imperative.'],
  description: ['string', 'Task detail, markdown.'],
  status: ['string', 'backlog, todo, in_progress, manual_testing, review_needed, or completed.'],
  priority: ['string', 'low, medium (default), high, or critical.'],
  taskPatch: ['object', 'Task fields to change, e.g. {"status":"in_progress","priority":"high"}.'],
  body: ['string', 'Comment text, markdown.'],
  items: ['array', 'Checklist items: [{"text":"Add the column"}, ...]. Replaces the whole list.'],
  index: ['number', 'Zero-based checklist item position, as shown by get_task.'],
  done: ['boolean', 'true to tick the item, false to untick it.'],
  to: ['string', 'Target machine id or name from list_machines; "self" for this machine.'],
  note: ['string', 'Note for the agent that picks up the work.'],
  closeSource: ['boolean', 'Kill the terminals of the source session after the handoff.'],
};

interface Tool {
  name: string;
  description: string;
  /** Field names from FIELDS; a trailing "!" marks it required. */
  fields: string[];
  run: (args: any) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'list_machines',
    description: 'Every remote-agent instance reachable from here, with online state. Use the ids/names as the `machine` argument of any other tool.',
    fields: [],
    run: async () => {
      machineCache = await listMachines();
      return machineCache;
    },
  },
  {
    name: 'list_projects',
    description: 'Projects registered on a machine.',
    fields: ['machine'],
    run: (a) => call('GET', '/projects', undefined, a.machine),
  },
  {
    name: 'list_sessions',
    description: 'Running agent sessions. Without `machine`, fans out to every reachable machine; with `machine`, lists that one (add all=true for finished sessions too).',
    fields: ['machine', 'all', 'limit'],
    run: async (a) => {
      if (!a.machine) {
        const data = await call('GET', '/sessions/sidebar/aggregate');
        return (data.machines ?? []).map((m: any) => ({
          machine: m.machineName,
          machineId: m.machineId,
          online: m.online,
          ...(m.error ? { error: m.error } : {}),
          // The aggregate has no activeOnly switch; filter here so "what's running"
          // isn't buried under every terminated session on the machine.
          sessions: flattenSessions(m.data).filter((x: any) => a.all || x.status !== 'terminated').slice(0, a.limit ?? 20),
        }));
      }
      const data = await call('GET', `/sessions/sidebar?activeOnly=${a.all ? '0' : '1'}`, undefined, a.machine);
      // A busy machine has hundreds of finished sessions — past the client's tool-output cap.
      return { machine: a.machine, sessions: flattenSessions(data).slice(0, a.limit ?? 20) };
    },
  },
  {
    name: 'open_session',
    description: 'Start a session and hand the agent a prompt. Returns the ids to poll with show_session and a URL to watch it in the UI.',
    fields: ['prompt!', 'projectId', 'machine', 'agent'],
    run: async (a) => {
      const session = await call('POST', '/sessions', { projectId: a.projectId }, a.machine);
      const terminal = await call(
        'POST',
        '/terminals',
        { sessionId: session.id, type: a.agent || 'claude', initialPrompt: a.prompt, persist: true },
        a.machine,
      );
      const machineId = (await resolveMachineId(a.machine)) ?? 'self';
      return {
        sessionId: session.id,
        terminalId: terminal.id,
        machine: a.machine ?? 'self',
        url: `${await base()}/sessions/${machineId}/${session.id}`,
        note: 'The agent is starting. Call show_session in a few seconds to read its output.',
      };
    },
  },
  {
    name: 'show_session',
    description: 'Session status plus the recent output of each of its terminals.',
    fields: ['sessionId!', 'machine', 'lines'],
    run: async (a) => {
      const [session, terminals] = await Promise.all([
        call('GET', `/sessions/${a.sessionId}`, undefined, a.machine),
        call('GET', `/terminals/session/${a.sessionId}`, undefined, a.machine),
      ]);
      const lines = a.lines ?? 120;
      return {
        id: session.id,
        status: session.liveStatus ?? session.status,
        project: session.project?.name ?? null,
        branch: session.worktree?.name ?? null,
        terminals: await Promise.all(
          (terminals as any[]).map(async (t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            status: t.liveStatus ?? t.status,
            // Per terminal: one unreadable terminal (or a machine on a build
            // without this route) shouldn't hide the session's status.
            ...(await call('GET', `/terminals/${t.id}/output?lines=${lines}`, undefined, a.machine)
              .then((r) => ({ output: r.output }))
              .catch((err: Error) => ({ output: null, outputError: err.message }))),
          })),
        ),
      };
    },
  },
  {
    name: 'send_prompt',
    description: 'Send a follow-up prompt to a running agent terminal (from show_session). Returns immediately — poll show_session for the reply.',
    fields: ['terminalId!', 'prompt!', 'machine'],
    run: async (a) => {
      // Text and Enter in one write reads as a paste to the agent TUI: the \r
      // lands as a newline and nothing is submitted. Same as the task loop:
      // bracketed paste, a beat for the TUI to take it, then Enter alone.
      const input = (data: string) => call('POST', `/terminals/${a.terminalId}/input`, { data }, a.machine);
      await input(`\x1b[200~${a.prompt}\x1b[201~`);
      await Bun.sleep(150);
      await input('\r');
      return { sent: true };
    },
  },
  {
    name: 'close_session',
    description: 'Close a session: kills its terminals and deletes it.',
    fields: ['sessionId!', 'machine'],
    run: (a) => call('DELETE', `/sessions/${a.sessionId}`, undefined, a.machine),
  },
  {
    name: 'handoff_session',
    description: 'Move a session to another machine: push its branch and uncommitted work through git origin, then start a new agent there on a fresh worktree.',
    fields: ['sessionId!', 'to!', 'machine', 'note', 'closeSource'],
    run: async (a) => {
      // The source machine resolves `to` itself; this machine's own id is "caller" when the source is remote.
      const to = (await resolveMachineId(a.to)) ?? ((await resolveMachineId(a.machine)) ? 'caller' : 'self');
      const out = await call('POST', `/sessions/${a.sessionId}/handoff`, { to, note: a.note, closeSource: a.closeSource }, a.machine);
      const machineId = (await resolveMachineId(a.to)) ?? 'self';
      return { ...out, url: `${await base()}/sessions/${machineId}/${out.sessionId}` };
    },
  },

  // ── Environment ────────────────────────────────────────────────────────────
  {
    name: 'get_env',
    description: "A project's environment variables, injected into every terminal it runs.",
    fields: ['projectId!', 'machine'],
    run: (a) => call('GET', `/projects/${a.projectId}/env`, undefined, a.machine),
  },
  {
    name: 'set_env',
    description: "Replace a project's environment variables. Read get_env first and send back the full map — anything omitted is deleted.",
    fields: ['projectId!', 'env!', 'machine'],
    run: (a) => call('PUT', `/projects/${a.projectId}/env`, { env: a.env }, a.machine),
  },

  // ── Run configs ────────────────────────────────────────────────────────────
  {
    name: 'list_runs',
    description: "A project's run configs (dev servers, scripts, previews).",
    fields: ['projectId!', 'machine'],
    run: (a) => call('GET', `/run-configs/project/${a.projectId}`, undefined, a.machine),
  },
  {
    name: 'create_run',
    description: 'Create a run config for a project.',
    fields: ['projectId!', 'name!', 'command!', 'adapterType', 'cwd', 'env', 'autoRestart', 'machine'],
    run: (a) =>
      call('POST', '/run-configs', {
        projectId: a.projectId,
        name: a.name,
        adapterType: a.adapterType || 'npm_script',
        command: a.command,
        cwd: a.cwd,
        env: a.env,
        autoRestart: a.autoRestart,
      }, a.machine),
  },
  {
    name: 'update_run',
    description: 'Change fields of a run config.',
    fields: ['runId!', 'patch!', 'machine'],
    run: (a) => call('PATCH', `/run-configs/${a.runId}`, a.patch, a.machine),
  },
  {
    name: 'delete_run',
    description: 'Delete a run config.',
    fields: ['runId!', 'machine'],
    run: (a) => call('DELETE', `/run-configs/${a.runId}`, undefined, a.machine),
  },
  {
    name: 'start_run',
    description: 'Start a run config inside a session (its output becomes a terminal there).',
    fields: ['runId!', 'sessionId!', 'machine'],
    run: (a) => call('POST', `/run-configs/${a.runId}/start`, { sessionId: a.sessionId }, a.machine),
  },
  {
    name: 'stop_run',
    description: 'Stop a running run config.',
    fields: ['runId!', 'machine'],
    run: (a) => call('POST', `/run-configs/${a.runId}/stop`, {}, a.machine),
  },

  // ── Run flows ──────────────────────────────────────────────────────────────
  {
    name: 'list_flows',
    description: "A project's run flows (run configs wired into a start-order graph).",
    fields: ['projectId!', 'machine'],
    run: (a) => call('GET', `/run-flows/project/${a.projectId}`, undefined, a.machine),
  },
  {
    name: 'get_flow',
    description: 'One flow with its nodes and edges.',
    fields: ['flowId!', 'machine'],
    run: (a) => call('GET', `/run-flows/${a.flowId}`, undefined, a.machine),
  },
  {
    name: 'create_flow',
    description: 'Create an empty run flow. Add nodes and edges with update_flow.',
    fields: ['projectId!', 'name!', 'machine'],
    run: (a) => call('POST', '/run-flows', { projectId: a.projectId, name: a.name }, a.machine),
  },
  {
    name: 'update_flow',
    description: 'Rename a flow or replace its graph: {"nodes":[{"runConfigId":"..","x":0,"y":0}],"edges":[{"sourceNodeId":"..","targetNodeId":"..","readyDelayMs":2000}]}. Nodes and edges are replaced wholesale.',
    fields: ['flowId!', 'patch!', 'machine'],
    run: (a) => call('PATCH', `/run-flows/${a.flowId}`, a.patch, a.machine),
  },
  {
    name: 'delete_flow',
    description: 'Delete a run flow.',
    fields: ['flowId!', 'machine'],
    run: (a) => call('DELETE', `/run-flows/${a.flowId}`, undefined, a.machine),
  },
  {
    name: 'run_flow',
    description: 'Start every node in a flow, in dependency order, inside a session.',
    fields: ['flowId!', 'sessionId!', 'machine'],
    run: (a) => call('POST', `/run-flows/${a.flowId}/run`, { sessionId: a.sessionId }, a.machine),
  },
  {
    name: 'stop_flow',
    description: 'Stop every node in a flow.',
    fields: ['flowId!', 'machine'],
    run: (a) => call('POST', `/run-flows/${a.flowId}/stop`, {}, a.machine),
  },
  {
    name: 'flow_status',
    description: 'Per-node running status of a flow.',
    fields: ['flowId!', 'machine'],
    run: (a) => call('GET', `/run-flows/${a.flowId}/status`, undefined, a.machine),
  },

  // ─── Kanban ─────────────────────────────────────────────────────────────
  // The board is the shared record between an agent and the person who filed
  // the task. Write back to it as you work, do not only read it.
  {
    name: 'list_tasks',
    description: 'Kanban tasks, newest board state. Filter by project or status. Use this to find the taskId for every other task tool.',
    fields: ['projectId', 'status', 'machine'],
    run: (a) => {
      const q = new URLSearchParams();
      if (a.projectId) q.set('projectId', a.projectId);
      if (a.status) q.set('status', a.status);
      q.set('topLevel', 'true');
      return call('GET', `/kanban/tasks?${q}`, undefined, a.machine);
    },
  },
  {
    name: 'get_task',
    description: 'One task in full: description, plan document, checklist with its item indexes, comments, and which project it belongs to. Re-read this when you lose the thread.',
    fields: ['taskId!', 'machine'],
    run: async (a) => {
      const t = await call('GET', `/kanban/tasks/${a.taskId}`, undefined, a.machine);
      return {
        ...t,
        // Flatten the JSON columns so the agent does not have to parse them.
        labels: t.labels ? JSON.parse(t.labels) : [],
        checklist: (t.checklist ? JSON.parse(t.checklist) : []).map(
          (it: { text: string; done: boolean }, index: number) => ({ index, ...it }),
        ),
      };
    },
  },
  {
    name: 'active_project',
    description: 'The project currently being worked in, judged by live sessions. Resolves only when one project is running; otherwise returns the candidates so you can ask which one.',
    fields: ['machine'],
    run: (a) => call('GET', '/kanban/active-project', undefined, a.machine),
  },
  {
    name: 'create_task',
    description: 'Add a task to the board. Give it a checklist when the work has three or more steps. Omit projectId to use the project currently being worked in — if that is not obvious this fails with the candidates, and you must ask which project before retrying. Never pick one yourself.',
    fields: ['title!', 'projectId', 'description', 'status', 'priority', 'items', 'machine'],
    run: async (a) => {
      let projectId = a.projectId;
      if (!projectId) {
        const active = await call('GET', '/kanban/active-project', undefined, a.machine);
        if (!active.resolved) {
          const list = active.candidates
            .map((c: any) => `${c.projectName} (${c.projectId}, ${c.sessions} session(s))`)
            .join('; ');
          throw new Error(
            active.reason === 'none'
              ? 'No project is running, so there is no obvious one to use. Ask which project this task belongs to, then pass projectId. Call list_projects for the choices.'
              : `Several projects are running: ${list}. Ask which one this task belongs to, then pass projectId.`,
          );
        }
        projectId = active.projectId;
      }
      return call('POST', '/kanban/tasks', {
        projectId,
        title: a.title,
        description: a.description,
        status: a.status,
        priority: a.priority,
        checklist: a.items,
      }, a.machine);
    },
  },
  {
    name: 'update_task',
    description: 'Change task fields — most often status as the work moves. Send only what changes.',
    fields: ['taskId!', 'taskPatch!', 'machine'],
    run: (a) => call('PATCH', `/kanban/tasks/${a.taskId}`, a.taskPatch, a.machine),
  },
  {
    name: 'comment_task',
    description: 'Post a progress note on the task. Use it when you finish a meaningful chunk, or when you find something that changes the plan.',
    fields: ['taskId!', 'body!', 'machine'],
    // kind 'result' marks it as the agent's note, so "send back" never returns it.
    run: (a) => call('POST', `/kanban/tasks/${a.taskId}/comments`, { content: a.body, kind: 'result' }, a.machine),
  },
  {
    name: 'set_checklist',
    description: 'Replace the task checklist. Use it once at the start to break the work down; use check_item after that, not this.',
    fields: ['taskId!', 'items!', 'machine'],
    run: (a) => call('PUT', `/kanban/tasks/${a.taskId}/checklist`, { items: a.items }, a.machine),
  },
  {
    name: 'check_item',
    description: 'Tick or untick one checklist item, by the index from get_task. Tick it when the step is really done, never in advance.',
    fields: ['taskId!', 'index!', 'done', 'machine'],
    run: (a) => call('POST', `/kanban/tasks/${a.taskId}/checklist/toggle`, {
      index: a.index,
      done: a.done !== false,
    }, a.machine),
  },
];

/** Sidebar payload → a flat session list; its project nesting is noise here. */
function flattenSessions(data: any): unknown[] {
  const out: unknown[] = [];
  for (const project of data?.projects ?? []) {
    for (const s of project.sessions ?? []) {
      out.push({ id: s.id, status: s.liveStatus ?? s.status, project: project.name, branch: s.branchName, lastActiveAt: s.lastActiveAt });
    }
  }
  for (const s of data?.unassignedSessions ?? []) {
    out.push({ id: s.id, status: s.liveStatus ?? s.status, project: null, branch: s.branchName, lastActiveAt: s.lastActiveAt });
  }
  // Newest first: "the latest session" is then simply the first match.
  return out.sort((x: any, y: any) => String(y.lastActiveAt ?? '').localeCompare(String(x.lastActiveAt ?? '')));
}

export function toolSchema(tool: Tool) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of tool.fields) {
    const name = field.endsWith('!') ? field.slice(0, -1) : field;
    const spec = FIELDS[name];
    if (!spec) throw new Error(`Tool ${tool.name}: unknown field ${name}`);
    properties[name] = { type: spec[0], description: spec[1] };
    if (field.endsWith('!')) required.push(name);
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', properties, required },
  };
}

// ─── JSON-RPC ─────────────────────────────────────────────────────────────────

type Rpc = { jsonrpc: '2.0'; id?: string | number; method?: string; params?: any };

/** Returns the response to send, or null for notifications (which get none). */
export async function handle(msg: Rpc): Promise<object | null> {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification: initialized, cancelled, ...

  const reply = (result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'remote-agent', version: VERSION },
      });

    case 'ping':
      return reply({});

    case 'tools/list':
      return reply({ tools: TOOLS.map(toolSchema) });

    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
      }
      // A failing tool is a result, not a protocol error — the model reads it.
      try {
        const result = await tool.run(params.arguments ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: (err as Error).message }], isError: true });
      }
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

async function main() {
  const send = (msg: object) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let msg: Rpc;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      // Sequential on purpose: tool calls mutate sessions, and clients wait anyway.
      const response = await handle(msg).catch((err: Error) => ({
        jsonrpc: '2.0' as const,
        id: msg.id ?? null,
        error: { code: -32603, message: err.message },
      }));
      if (response) send(response);
    }
  }
}

if (import.meta.main) main();
