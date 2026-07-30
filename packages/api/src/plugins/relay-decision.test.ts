import { describe, expect, test } from 'bun:test';
import { decideRelay, type RelayInput } from './relay-decision';

const base: RelayInput = {
  targetMachineId: 'B',
  hops: null,
  callerMachineId: 'A',
  callerOwnerUserId: 'user-1',
  targetOwnerUserId: 'user-1',
  targetOnline: true,
  selfMachineId: 'hub',
};

describe('decideRelay — pass-through', () => {
  test('no target header: serve locally', () => {
    expect(decideRelay({ ...base, targetMachineId: null })).toEqual({ action: 'serve-locally' });
  });

  test('addressed to this machine: serve locally, do not relay to self', () => {
    expect(decideRelay({ ...base, targetMachineId: 'hub' })).toEqual({ action: 'serve-locally' });
  });

  test('valid peer request relays', () => {
    expect(decideRelay(base)).toEqual({ action: 'relay', targetMachineId: 'B' });
  });

  test('a cookie-authenticated user may relay too', () => {
    expect(decideRelay({ ...base, callerMachineId: null })).toEqual({
      action: 'relay', targetMachineId: 'B',
    });
  });
});

describe('decideRelay — loop prevention', () => {
  // Without the hop limit, two machines that each list the other as a peer
  // bounce a request between them until something times out.
  test('an already-relayed request is refused', () => {
    expect(decideRelay({ ...base, hops: '1' })).toMatchObject({ action: 'reject', status: 508 });
  });

  test('hop header is honoured even at value 0', () => {
    expect(decideRelay({ ...base, hops: '0' })).toMatchObject({ action: 'reject', status: 508 });
  });

  test('relaying back to the caller is refused', () => {
    expect(decideRelay({ ...base, targetMachineId: 'A' })).toMatchObject({
      action: 'reject', status: 400,
    });
  });
});

describe('decideRelay — authorization', () => {
  // The check that keeps a machineToken scoped to its own owner's mesh.
  test('a machine owned by someone else is refused', () => {
    expect(decideRelay({ ...base, targetOwnerUserId: 'user-2' })).toMatchObject({
      action: 'reject', status: 403,
    });
  });

  test('unauthenticated callers cannot relay', () => {
    expect(decideRelay({ ...base, callerOwnerUserId: null })).toMatchObject({
      action: 'reject', status: 401,
    });
  });

  test('unknown target is a 404, not a 403 — nothing to leak', () => {
    expect(decideRelay({ ...base, targetOwnerUserId: null })).toMatchObject({
      action: 'reject', status: 404,
    });
  });

  test('ownership is checked before liveness', () => {
    // An offline machine belonging to someone else must still 403, so the
    // response cannot be used to probe which ids exist on the hub.
    expect(decideRelay({ ...base, targetOwnerUserId: 'user-2', targetOnline: false }))
      .toMatchObject({ action: 'reject', status: 403 });
  });
});

describe('decideRelay — liveness', () => {
  test('offline target is a 502', () => {
    expect(decideRelay({ ...base, targetOnline: false })).toMatchObject({
      action: 'reject', status: 502,
    });
  });
});
