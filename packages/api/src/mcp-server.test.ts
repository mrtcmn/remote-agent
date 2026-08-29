import { test, expect, beforeEach } from 'bun:test';

// A machine token skips the sign-in round trip; the stub below only serves /api.
process.env.RA_TOKEN = 'test-token';
process.env.RA_URL = 'http://ra.test';

const { handle, toolSchema } = await import('./mcp-server');

type Recorded = { method: string; path: string; body: any; machine: string | null };
let calls: Recorded[] = [];
let responses: Record<string, unknown> = {};

beforeEach(() => {
  calls = [];
  responses = {};
});

globalThis.fetch = (async (url: string, init: any = {}) => {
  const path = url.replace('http://ra.test/api', '');
  calls.push({
    method: init.method ?? 'GET',
    path,
    body: init.body ? JSON.parse(init.body) : undefined,
    machine: init.headers?.['x-target-machine-id'] ?? null,
  });
  const key = `${init.method ?? 'GET'} ${path}`;
  if (key in responses) {
    const value = responses[key];
    if (value instanceof Error) {
      return Response.json({ error: value.message }, { status: 500 });
    }
    if (value === 'html') {
      // What the server actually serves on an unknown path: its SPA shell.
      return new Response('<!DOCTYPE html><html></html>', { headers: { 'content-type': 'text/html' } });
    }
    return Response.json(value);
  }
  return Response.json({});
}) as unknown as typeof fetch;

const callTool = (name: string, args: object = {}) =>
  handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

const payload = (res: any) => JSON.parse(res.result.content[0].text);

test('every tool advertises a valid schema', async () => {
  const res: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tools = res.result.tools;
  expect(tools.length).toBeGreaterThan(15);
  for (const tool of tools) {
    expect(tool.name).toMatch(/^[a-z_]+$/);
    expect(tool.description.length).toBeGreaterThan(10);
    expect(tool.inputSchema.type).toBe('object');
    // Required fields must actually be declared.
    for (const req of tool.inputSchema.required) {
      expect(tool.inputSchema.properties[req]).toBeDefined();
    }
  }
});

test('toolSchema rejects a field with no description', () => {
  expect(() => toolSchema({ name: 'x', description: 'd', fields: ['nope'], run: async () => null }))
    .toThrow(/unknown field nope/);
});

test('open_session creates the session then the agent terminal with the prompt', async () => {
  responses['POST /sessions'] = { id: 'sess1' };
  responses['POST /terminals'] = { id: 'term1' };

  const out = payload(await callTool('open_session', { prompt: 'fix the tests', projectId: 'p1' }));

  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /sessions', 'POST /terminals']);
  expect(calls[0].body).toEqual({ projectId: 'p1' });
  expect(calls[1].body).toMatchObject({ sessionId: 'sess1', type: 'claude', initialPrompt: 'fix the tests' });
  expect(out).toMatchObject({ sessionId: 'sess1', terminalId: 'term1', url: 'http://ra.test/sessions/self/sess1' });
});

test('a machine name is resolved to an id and relayed via the header', async () => {
  responses['GET /sessions/sidebar/aggregate'] = {
    machines: [
      { machineId: 'self', machineName: 'This machine', online: true, data: { projects: [], unassignedSessions: [] } },
      { machineId: 'm-42', machineName: 'Studio', online: true, data: { projects: [], unassignedSessions: [] } },
    ],
  };

  await callTool('close_session', { sessionId: 's9', machine: 'studio' });

  const del = calls.find((c) => c.method === 'DELETE')!;
  expect(del.path).toBe('/sessions/s9');
  expect(del.machine).toBe('m-42');
});

test('an unknown machine fails the call instead of hitting the wrong one', async () => {
  responses['GET /sessions/sidebar/aggregate'] = { machines: [] };
  const res: any = await callTool('close_session', { sessionId: 's9', machine: 'ghost' });

  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain('Unknown machine "ghost"');
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});

test('list_sessions flattens every machine when none is named', async () => {
  responses['GET /sessions/sidebar/aggregate'] = {
    machines: [
      {
        machineId: 'self',
        machineName: 'This machine',
        online: true,
        data: {
          projects: [{ name: 'api', sessions: [{ id: 's1', liveStatus: 'active', branchName: 'main' }] }],
          unassignedSessions: [{ id: 's2', status: 'waiting_input' }],
        },
      },
      { machineId: 'm-42', machineName: 'Studio', online: false, error: 'HTTP 502 from cloudflare', data: { projects: [], unassignedSessions: [] } },
    ],
  };

  const out = payload(await callTool('list_sessions'));

  expect(out[0].sessions).toEqual([
    { id: 's1', status: 'active', project: 'api', branch: 'main', lastActiveAt: undefined },
    { id: 's2', status: 'waiting_input', project: null, branch: undefined, lastActiveAt: undefined },
  ]);
  expect(out[1]).toMatchObject({ machine: 'Studio', online: false, error: 'HTTP 502 from cloudflare' });
});

test('a route the instance does not have is reported, not silently empty', async () => {
  // Unknown /api paths fall through to the SPA with HTTP 200 — an older build.
  responses['GET /projects/p1/env'] = 'html';
  const res: any = await callTool('get_env', { projectId: 'p1' });

  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain('HTML, not JSON');
});

test('an API failure comes back as a tool error, not a protocol error', async () => {
  responses['GET /projects/p1/env'] = new Error('Project not found');
  const res: any = await callTool('get_env', { projectId: 'p1' });

  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain('Project not found');
});

test('set_env sends the whole map', async () => {
  await callTool('set_env', { projectId: 'p1', env: { API_URL: 'x' } });
  expect(calls[0]).toMatchObject({ method: 'PUT', path: '/projects/p1/env', body: { env: { API_URL: 'x' } } });
});

test('notifications get no reply, unknown methods get -32601', async () => {
  expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();

  const res: any = await handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  expect(res.error.code).toBe(-32601);
});

test('initialize echoes the protocol version the client asked for', async () => {
  const res: any = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  expect(res.result.protocolVersion).toBe('2024-11-05');
  expect(res.result.capabilities.tools).toBeDefined();
  expect(res.result.serverInfo.name).toBe('remote-agent');
});
