import { describe, expect, it } from 'bun:test';
import { diffPanels, sessionHue, zoneAt } from './views';

const rect = { left: 0, top: 0, width: 400, height: 200 };

describe('zoneAt', () => {
  it('picks the nearest edge in the outer quarter', () => {
    expect(zoneAt(20, 100, rect)).toBe('left');
    expect(zoneAt(390, 100, rect)).toBe('right');
    expect(zoneAt(200, 10, rect)).toBe('top');
    expect(zoneAt(200, 190, rect)).toBe('bottom');
  });

  it('the middle is no zone', () => {
    expect(zoneAt(200, 100, rect)).toBeNull();
  });

  it('a corner goes to the closer edge', () => {
    expect(zoneAt(10, 30, rect)).toBe('left'); // 2.5% from left, 15% from top
  });

  it('outside the box is no zone', () => {
    expect(zoneAt(-5, 100, rect)).toBeNull();
  });
});

describe('diffPanels', () => {
  it('finds layout panels without a row, and rows without a place', () => {
    expect(diffPanels(['a', 'b'], [{ id: 'b' }, { id: 'c' }])).toEqual({ stale: ['a'], missing: ['c'] });
  });

  it('nothing to do when they match', () => {
    expect(diffPanels(['a'], [{ id: 'a' }])).toEqual({ stale: [], missing: [] });
  });
});

describe('sessionHue', () => {
  it('is stable and in range', () => {
    expect(sessionHue('abc')).toBe(sessionHue('abc'));
    expect(sessionHue('abc')).toBeGreaterThanOrEqual(0);
    expect(sessionHue('abc')).toBeLessThan(360);
  });
});
