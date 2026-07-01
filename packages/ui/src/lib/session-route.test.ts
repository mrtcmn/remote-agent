import { describe, expect, test } from 'bun:test';
import { sessionPath, sessionIdFromPath } from './session-route';

describe('sessionPath', () => {
  test('builds a machine-scoped session path', () => {
    expect(sessionPath('self', 's1')).toBe('/sessions/self/s1');
    expect(sessionPath('0946cc1e', 'J1VVn4')).toBe('/sessions/0946cc1e/J1VVn4');
  });

  test('appends the terminal id when provided', () => {
    expect(sessionPath('m1', 's1', 't1')).toBe('/sessions/m1/s1/t1');
  });

  test('omits the terminal segment when terminalId is falsy', () => {
    expect(sessionPath('m1', 's1', undefined)).toBe('/sessions/m1/s1');
    expect(sessionPath('m1', 's1', '')).toBe('/sessions/m1/s1');
  });
});

describe('sessionIdFromPath', () => {
  test('extracts the session id from a machine-scoped path', () => {
    expect(sessionIdFromPath('/sessions/0946cc1e/J1VVn4')).toBe('J1VVn4');
    expect(sessionIdFromPath('/sessions/self/s1')).toBe('s1');
  });

  test('extracts the session id when a terminal segment is present', () => {
    expect(sessionIdFromPath('/sessions/m1/s1/t1')).toBe('s1');
  });

  test('supports the legacy bare session path', () => {
    expect(sessionIdFromPath('/sessions/s1')).toBe('s1');
  });

  test('returns null for non-session paths', () => {
    expect(sessionIdFromPath('/')).toBeNull();
    expect(sessionIdFromPath('/kanban')).toBeNull();
    expect(sessionIdFromPath('/sessions')).toBeNull();
  });
});
