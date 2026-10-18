import { expect, test } from 'bun:test';
import { mapStreamLine } from './index';

test('maps claude stream-json lines to operator events', () => {
  expect(mapStreamLine({ type: 'system', subtype: 'init', session_id: 's1' })).toEqual([{ type: 'session', sessionId: 's1' }]);
  expect(mapStreamLine({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'mcp__ra__show_session', input: { sessionId: 'x' } }] },
  })).toEqual([
    { type: 'text', text: 'Checking.' },
    { type: 'step', id: 't1', tool: 'show_session', input: { sessionId: 'x' } },
  ]);
  expect(mapStreamLine({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }] }] },
  })).toEqual([{ type: 'step_done', id: 't1', ok: false, output: 'boom' }]);
  expect(mapStreamLine({ type: 'result', is_error: false, result: 'All good.', session_id: 's1' })).toEqual([{ type: 'done', text: 'All good.', sessionId: 's1' }]);
  expect(mapStreamLine({ type: 'result', is_error: true, result: 'nope' })).toEqual([{ type: 'error', message: 'nope' }]);
});

test('handoffTarget picks the agent to watch from send_prompt and open_session', async () => {
  const { handoffTarget } = await import('./index');
  expect(handoffTarget('send_prompt', { terminalId: 't1', machine: 'r01' }, '{"sent":true}')).toEqual({ terminalId: 't1', machine: 'r01' });
  expect(handoffTarget('open_session', {}, '{"sessionId":"s1","terminalId":"t2"}')).toEqual({ sessionId: 's1', terminalId: 't2', machine: undefined });
  expect(handoffTarget('list_sessions', {}, '[]')).toBeNull();
});

test('matches only finished/blocked hook notifications of the watched terminal', async () => {
  const { matches } = await import('./watch');
  const t = { sessionId: 's1', terminalId: 't1' };
  expect(matches({ type: 'task_complete', terminalId: 't1', sessionId: 's1' }, t)).toBe(true);
  expect(matches({ type: 'task_complete', terminalId: 't9', sessionId: 's1' }, t)).toBe(false);
  expect(matches({ type: 'session_started', terminalId: 't1' }, t)).toBe(false);
  expect(matches({ type: 'user_input_required', sessionId: 's1' }, t)).toBe(true);
});
