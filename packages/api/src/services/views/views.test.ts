import { describe, expect, test } from 'bun:test';
import { nextViewName, sessionChips } from './index';

describe('nextViewName', () => {
  test('starts at View 1', () => {
    expect(nextViewName([])).toBe('View 1');
  });

  test('fills the lowest free number', () => {
    expect(nextViewName(['View 1', 'View 3'])).toBe('View 2');
  });

  test('renamed views do not hold a number', () => {
    expect(nextViewName(['Review', 'View 1'])).toBe('View 2');
  });
});

describe('sessionChips', () => {
  test('one chip per session, in panel order', () => {
    expect(sessionChips([
      { machineId: null, sessionId: 'a' },
      { machineId: null, sessionId: 'b' },
      { machineId: null, sessionId: 'a' },
    ])).toEqual([
      { machineId: null, sessionId: 'a' },
      { machineId: null, sessionId: 'b' },
    ]);
  });

  test('the same session id on two machines is two chips', () => {
    expect(sessionChips([
      { machineId: null, sessionId: 'a' },
      { machineId: 'r01', sessionId: 'a' },
    ])).toHaveLength(2);
  });
});
