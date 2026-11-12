import { expect, test } from 'bun:test';
import { DirectPaths } from './direct-path';
import type { MachineTarget } from './resolve';

const relay: MachineTarget = { kind: 'relay', machineId: 'B', name: 'b', url: 'https://hub', token: 't', via: 'H' };
const mint = () => ({ ticket: 'tk', exp: 10 * 60_000 });

test('a reachable direct address replaces the relay, after the first check', async () => {
  let clock = 0;
  const paths = new DirectPaths(async () => true, () => clock);
  expect(paths.upgrade(relay, 'http://100.64.0.2:5100', mint)).toBe(relay); // never waits
  await paths.settle();
  expect(paths.upgrade(relay, 'http://100.64.0.2:5100', mint)).toEqual({
    kind: 'direct', machineId: 'B', name: 'b', url: 'http://100.64.0.2:5100', token: 'tk', auth: 'ticket', fallback: relay,
  });
});

test('an unreachable address keeps the relay and is not checked again for 30 s', async () => {
  let clock = 0, probes = 0;
  const paths = new DirectPaths(async () => { probes++; throw new Error('timeout'); }, () => clock);
  paths.upgrade(relay, 'http://x', mint);
  await paths.settle();
  clock = 20_000;
  expect(paths.upgrade(relay, 'http://x', mint)).toBe(relay);
  await paths.settle();
  expect(probes).toBe(1);
  clock = 31_000;
  paths.upgrade(relay, 'http://x', mint);
  await paths.settle();
  expect(probes).toBe(2);
});

test('a failed direct call returns to the relay; a wrong machine at the address is refused', async () => {
  let clock = 0;
  const paths = new DirectPaths(async () => true, () => clock);
  paths.upgrade(relay, 'http://x', mint);
  await paths.settle();
  paths.fail('B');
  expect(paths.upgrade(relay, 'http://x', mint)).toBe(relay);

  const wrong = new DirectPaths(async () => false, () => clock);
  wrong.upgrade(relay, 'http://x', mint);
  await wrong.settle();
  expect(wrong.upgrade(relay, 'http://x', mint)).toBe(relay);
});

test('no direct address, or the same address, changes nothing', () => {
  const paths = new DirectPaths(async () => true);
  expect(paths.upgrade(relay, null, mint)).toBe(relay);
  const master: MachineTarget = { kind: 'direct', machineId: 'H', name: 'h', url: 'http://100.64.0.1:5100', token: 't' };
  expect(paths.upgrade(master, 'http://100.64.0.1:5100', mint)).toBe(master);
});
