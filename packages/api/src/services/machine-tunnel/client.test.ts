import { test, expect } from 'bun:test';
import { nextAttempts, retryDelay } from './client';

// The bug this guards: the client cleared the attempt count on every 'open'.
// A master that accepted and dropped the socket at once looped forever at
// ~600ms, and the count never reached the give-up limit.
test('a flapping tunnel counts up to the give-up limit', () => {
  let attempts = 0;
  for (let i = 0; i < 10; i++) attempts = nextAttempts(attempts, 300);
  expect(attempts).toBe(10);
});

test('a connection that held resets the count', () => {
  expect(nextAttempts(7, 60_000)).toBe(1);
  expect(nextAttempts(7, 59_999)).toBe(8);
});

test('backoff grows and stops at the ceiling', () => {
  expect(retryDelay(1, 0)).toBe(500);
  expect(retryDelay(1, 1)).toBe(1_000);
  expect(retryDelay(5, 1)).toBe(16_000);
  expect(retryDelay(9, 1)).toBe(30_000);
});
