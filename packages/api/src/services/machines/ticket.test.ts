import { expect, test } from 'bun:test';
import { signTicket, verifyTicket } from './ticket';

const key = 'a'.repeat(64);
test('round trip', () => {
  const t = signTicket({ from: 'A', to: 'B', exp: 2_000 }, key);
  expect(verifyTicket(t, key, 'B', 1_000)).toEqual({ from: 'A', to: 'B', exp: 2_000 });
});
test('rejects: expired, wrong target, wrong key, edited payload', () => {
  const t = signTicket({ from: 'A', to: 'B', exp: 2_000 }, key);
  expect(verifyTicket(t, key, 'B', 3_000)).toBeNull();
  expect(verifyTicket(t, key, 'C', 1_000)).toBeNull();
  expect(verifyTicket(t, 'b'.repeat(64), 'B', 1_000)).toBeNull();
  expect(verifyTicket('x' + t, key, 'B', 1_000)).toBeNull();
});
