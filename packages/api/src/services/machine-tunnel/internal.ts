/**
 * Proof that a request came from this process's own tunnel client rather than
 * off the network.
 *
 * Regenerated every boot and never transmitted: the tunnel client stamps it on
 * requests it dispatches into our own Elysia app, and the auth middleware trusts
 * it to resolve the owner user. An attacker would need code execution in this
 * process to forge it, at which point the header is moot.
 *
 * Isolated in its own module so `auth/middleware.ts` can read it without
 * importing the tunnel client (which imports the database, which imports auth).
 */
export const TUNNEL_INTERNAL_SECRET = crypto.randomUUID();
export const TUNNEL_AUTH_HEADER = 'x-tunnel-internal';
export const TUNNEL_MACHINE_HEADER = 'x-tunnel-origin-machine';
