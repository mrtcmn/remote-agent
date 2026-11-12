import { expect, test } from 'bun:test';
import { viewers } from './preview.routes';

test('viewer expires after 10 s without a poll', () => {
  viewers.seen('s1', 'machine-d', 'u', 1_000);
  expect(viewers.of('s1', 5_000)?.machineId).toBe('machine-d');
  expect(viewers.of('s1', 12_000)).toBeNull();
});
test('the latest poller wins', () => {
  viewers.seen('s2', 'a', 'u', 1_000);
  viewers.seen('s2', 'b', 'u', 2_000);
  expect(viewers.of('s2', 3_000)?.machineId).toBe('b');
  viewers.seen('s3', 'c', 'u', 2_500);
  expect(viewers.latest(3_000)?.machineId).toBe('c');
});
