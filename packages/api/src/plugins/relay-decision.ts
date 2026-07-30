/**
 * Pure decision for the master's relay hop (secondary A → master → secondary B).
 *
 * Kept free of Elysia and the database so the guard matrix can be tested
 * exhaustively — these checks are the only thing standing between a valid
 * machineToken and every machine on the hub.
 */

export type RelayDecision =
  | { action: 'serve-locally' }
  | { action: 'relay'; targetMachineId: string }
  | { action: 'reject'; status: number; error: string };

export interface RelayInput {
  /** X-Target-Machine-Id, if present. */
  targetMachineId: string | null;
  /** X-Machine-Hops — any value means this request was already relayed once. */
  hops: string | null;
  /** Machine this request authenticated as, or null for a cookie/user session. */
  callerMachineId: string | null;
  /** Owner of the authenticated caller. */
  callerOwnerUserId: string | null;
  /** Owner of the requested target, or null if we do not know that machine. */
  targetOwnerUserId: string | null;
  /** Whether the target currently holds a tunnel to us. */
  targetOnline: boolean;
  /** This machine's own id, so a request addressed to us is served, not relayed. */
  selfMachineId?: string | null;
}

export function decideRelay(input: RelayInput): RelayDecision {
  const target = input.targetMachineId;

  // Not addressed elsewhere — normal local request.
  if (!target) return { action: 'serve-locally' };
  if (input.selfMachineId && target === input.selfMachineId) return { action: 'serve-locally' };

  // Addressed to the caller itself: would bounce straight back.
  if (input.callerMachineId && target === input.callerMachineId) {
    return { action: 'reject', status: 400, error: 'Cannot relay a request to its own origin' };
  }

  // Already relayed once. A star topology never needs a second hop, and
  // allowing one lets two mutual peers bounce a request forever.
  if (input.hops != null) {
    return { action: 'reject', status: 508, error: 'Relay hop limit exceeded' };
  }

  // Must be authenticated to relay at all.
  if (!input.callerOwnerUserId) {
    return { action: 'reject', status: 401, error: 'Unauthorized' };
  }

  if (!input.targetOwnerUserId) {
    return { action: 'reject', status: 404, error: 'Unknown target machine' };
  }

  // The check that makes a machineToken scoped: it may only reach machines
  // belonging to the same owner.
  if (input.targetOwnerUserId !== input.callerOwnerUserId) {
    return { action: 'reject', status: 403, error: 'Target machine belongs to another owner' };
  }

  if (!input.targetOnline) {
    return { action: 'reject', status: 502, error: 'Target machine is offline' };
  }

  return { action: 'relay', targetMachineId: target };
}
