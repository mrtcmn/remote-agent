import { test, expect } from 'bun:test';
import { describeTool, shortModelName, parseTranscript } from './hooks.helpers';

test('describeTool summarizes the common tools', () => {
  expect(describeTool('Edit', { file_path: '/a/b/auth.ts' })).toBe('Editing auth.ts');
  expect(describeTool('Write', { file_path: 'notch.swift' })).toBe('Editing notch.swift');
  expect(describeTool('Read', { file_path: '/x/y/README.md' })).toBe('Reading README.md');
  expect(describeTool('Bash', { command: 'bun test --watch' })).toBe('Running bun');
  expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Searching TODO');
  // tool_input can arrive as a JSON string too
  expect(describeTool('Edit', JSON.stringify({ file_path: 'x.ts' }))).toBe('Editing x.ts');
  // mcp tools get a readable-ish fallback; unknown tools pass through
  expect(describeTool('mcp__figma__get_screenshot', {})).toBe('figma get_screenshot');
  expect(describeTool(undefined, {})).toBeUndefined();
});

test('shortModelName extracts the family', () => {
  expect(shortModelName('claude-opus-4-8[1m]')).toBe('opus');
  expect(shortModelName('claude-3-5-sonnet-20241022')).toBe('sonnet');
  expect(shortModelName('gpt-4')).toBe('gpt-4'); // no family → raw id
  expect(shortModelName(undefined)).toBeUndefined();
});

test('parseTranscript pulls model, todos, and context% from the newest turn', () => {
  const lines = [
    // older assistant turn — should be shadowed by the newer one for model/ctx
    { type: 'assistant', message: { model: 'claude-3-5-sonnet', usage: { input_tokens: 10 } , content: [] } },
    // a TodoWrite: 1 of 3 done
    { type: 'assistant', message: { model: 'claude-opus-4-8', content: [
      { type: 'tool_use', name: 'TodoWrite', input: { todos: [
        { status: 'completed' }, { status: 'in_progress' }, { status: 'pending' },
      ] } },
    ] } },
    // newest assistant turn: opus, ~40k prompt tokens → 20%
    { type: 'assistant', message: {
      model: 'claude-opus-4-8[1m]',
      usage: { input_tokens: 2_000, cache_read_input_tokens: 38_000 },
      content: [{ type: 'text', text: 'done' }],
    } },
  ].map(o => JSON.stringify(o)).join('\n');

  const info = parseTranscript(lines);
  expect(info.model).toBe('opus');           // newest wins
  expect(info.contextPct).toBe(20);          // 40k / 200k
  expect(info.todosTotal).toBe(3);
  expect(info.todosDone).toBe(1);
  expect(info.summary).toBe('done');
});

test('parseTranscript is empty-safe', () => {
  expect(parseTranscript('')).toEqual({});
  expect(parseTranscript('not json\n{bad')).toEqual({});
});
