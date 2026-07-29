import { test, expect } from 'bun:test';
import { extractJSON } from './openai.engine';

type J = Record<string, unknown>;

test('extractJSON parses clean, fenced, and prose-wrapped JSON', () => {
  expect(extractJSON<J>('{"a":1}')).toEqual({ a: 1 });
  // ``` fences + language tag
  expect(extractJSON<J>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  // leading prose the model tacked on
  expect(extractJSON<J>('Sure! Here you go: {"a":1,"b":["x"]} done')).toEqual({ a: 1, b: ['x'] });
  // unparseable → undefined (caller falls back)
  expect(extractJSON<J>('not json at all')).toBeUndefined();
});
