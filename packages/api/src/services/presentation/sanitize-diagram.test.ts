import { test, expect } from 'bun:test';
import { sanitizeDiagram } from './presentation.service';

test('strips ```mermaid fences and keeps valid diagram', () => {
  const out = sanitizeDiagram('```mermaid\nflowchart TD\n  A --> B\n```');
  expect(out).toBe('flowchart TD\n  A --> B');
});

test('accepts a bare valid diagram', () => {
  expect(sanitizeDiagram('sequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram\n  A->>B: hi');
});

test('rejects non-mermaid noise and empties', () => {
  expect(sanitizeDiagram('')).toBe('');
  expect(sanitizeDiagram(undefined)).toBe('');
  expect(sanitizeDiagram('Here is a diagram of the flow')).toBe(''); // prose, not mermaid
  expect(sanitizeDiagram('flow')).toBe(''); // too short
});
