# Full-Mesh Machine Access — Master as Relay Hub

**Date:** 2026-07-29
**Status:** Implemented (Phases 1–4, 6, 7) — 25 unit tests, both packages type-clean, and a
live three-instance mesh passing 7/7 including the A→hub→B relay. **Phase 5 (WebSocket over the
tunnel) is written but NOT verified** — no live terminal has run through it.
**Builds on:** `2026-04-23-secondary-machine-pairing-design.md`, `2026-06-03-multi-machine-aggregation-design.md`

---

## The problem, stated precisely

Today every machine-to-machine call is `fetch(master.url, { Bearer machineToken })`. That works
in exactly one direction because **only the master has a reachable URL**. A secondary sits behind
NAT and stores no inbound address — `machines` rows have no `url` column at all, by design
(`2026-04-23…:94` — "Secondary's URL is never stored — it's not reachable").

Consequences visible today:

- `fanOutToMasters` (`fan-out.ts:16`) enumerates `pairedMastersService.list(userId)` — **paired
  masters only**. On a master that list is empty, so the aggregated sidebar shows one section:
  self. The two secondaries are invisible.
- `machineProxyPlugin` (`machine-proxy.ts:90`) resolves `machineId` via `pairedMastersService.get`.
  A secondary's id resolves to nothing → 404.
- A master knows a secondary exists (`machines` table, `MachinesSection.tsx`) but only via what the
  secondary *pushes*: `sessionCount`, `version`, `lastSeenAt`. Status, not content.

So this is not a missing feature so much as a missing **transport**. Everything above the transport
already exists and is machine-id-keyed.

### The full requirement: every machine reaches every machine

Master → secondary is only half of it. **Secondary A must also reach secondary B**, and since
neither has a URL, the master relays between them. The target topology is a star with the master
as hub — any pair of machines is reachable in **at most one relay hop**, provided both pair with
the same master.

```
         SECONDARY A ──┐                    ┌── A→master        : direct fetch (exists today)
                       ├──▶  MASTER  ◀──────┤   master→A/B      : reverse tunnel (§Transport)
         SECONDARY B ──┘      (hub)         └── A→master→B      : relay (§Relay)
```

This matters for the design because the master stops being merely an endpoint and becomes a
**broker**: it must forward a request that arrives authenticated-as-machine-A onward to machine B,
rather than serving it locally. That is currently forbidden on purpose (`machine-proxy.ts:76`:
"a paired secondary shouldn't daisy-chain through another master") — retiring that rule is part of
this work, and it is what forces hop-limiting and same-owner checks below.

---

## Decision: reverse tunnel over a socket the secondary opens

The secondary already talks to the master every 30s (`master-sync/index.ts:29`). Upgrade that
outbound poll into a **persistent WebSocket the secondary holds open**, and multiplex
request/response frames over it. The master then has a way to *call* a secondary without the
secondary ever listening on a port.

Alternatives rejected:

| Option | Why not |
|---|---|
| Secondary registers a public URL | Requires the user to expose a port / run a tunnel service. Defeats the point of local mode. |
| Push full state in heartbeat (see "Lazy version" below) | Read-only. No terminals, no file browser, no session control. |
| Third-party relay (ngrok/Cloudflare) | New dependency, new trust boundary, per-user config. |
| Long-poll (secondary asks "any work for me?") | Reinvents WebSockets with worse latency and more requests. |

**Why this is cheap:** the master side already funnels *every* cross-machine call through two files
(`fan-out.ts` and `machine-proxy.ts`). Adding a second transport is a switch in those two places,
not a rewrite. No route in the codebase changes.

---

## Architecture

```
                    secondary opens & holds
   ┌──────────┐   ═══════════════════════════▶   ┌────────┐
   │ SECONDARY│   wss://master/ws/machine-tunnel  │ MASTER │
   │  (NAT)   │                                   │        │
   │          │  ◀── req frame  {id, method, path}│        │
   │  app     │  ─── res frame  {id, status, body}│  tunnel│
   │ .handle()│                                   │ registry│
   └──────────┘                                   └────────┘
                                                       ▲
                              fan-out.ts / machine-proxy.ts
                              pick transport by machine kind
```

### 1. Transport — `packages/api/src/services/machine-tunnel/`

**`server.ts` (master side)** — one new WS route, registered like the existing proxy WS:

- `.ws('/ws/machine-tunnel')`, authenticated by `machineRegistry.findByToken(bearer)`
  (`machine-registry/index.ts:72`) — same token that already authenticates heartbeats.
- Holds `Map<machineId, TunnelConn>`. A second connection for the same machineId replaces the
  first (last-writer-wins, closes the stale one).
- Exposes two functions, deliberately shaped like their `fetch`/`WebSocket` counterparts so the
  call sites barely change:
  - `tunnelFetch(machineId, path, init) → Promise<Response>`
  - `tunnelWs(machineId, path) → WebSocketLike` (open/message/close/send)
- Marks `lastSeenAt` on connect and on ping, so `online` in `listForUser` (`machine-registry/index.ts:101`)
  becomes socket-liveness rather than 30s-poll-liveness. Strictly better signal.

**`client.ts` (secondary side)** — replaces the polling loop in `master-sync/index.ts`:

- Connects to each paired master, exponential backoff on drop (1s → 30s cap, jitter).
- Sends heartbeat over the socket instead of `POST /machines/heartbeat`; keeps the HTTP endpoint
  for one release so a new secondary works against an old master.
- On a `req` frame: builds a `Request` and dispatches it **in-process** via `app.handle(request)`
  — Elysia dispatches without a socket, so there is no loopback port and no second auth hop.
- Ping/pong every 20s; a missed pong closes and reconnects (half-open TCP is the classic failure
  here and will not surface any other way).

**`protocol.ts`** — frame types, one file, no library:

```ts
type Frame =
  | { t: 'req';   id: string; method: string; path: string; headers: Record<string,string>; body?: string }
  | { t: 'res';   id: string; status: number; headers: Record<string,string> }
  | { t: 'chunk'; id: string; data: string }        // base64; empty data = EOF
  | { t: 'err';   id: string; message: string }
  | { t: 'wsopen'|'wsmsg'|'wsclose'; id: string; path?: string; data?: string }
  | { t: 'ping' } | { t: 'pong' };
```

`id` is a per-request uuid. Bodies are base64 in v1 — simple, and the one genuinely
throughput-sensitive path (terminal I/O) uses the `ws*` frames, not `chunk`.

### 2. Auth on the secondary — `machineTunnelAuthPlugin`

A tunneled request arrives with no cookie. Mirror what the master already does for the other
direction (`machineTokenAuthPlugin`, `2026-04-23…:186`): the tunnel client stamps an internal
header carrying a per-process random secret, and a plugin on the secondary derives the owner user
from it. The secret never leaves the process, and `app.handle()` means the request never touches a
network interface — so this is not a new externally-reachable auth path.

**Requests are executed as the pairing owner.** A machineToken already grants full API access in
the existing direction; this keeps the trust model symmetric rather than inventing a second one.

### 3. Unified machine resolution — `services/machines/resolve.ts` (new)

The one genuinely new abstraction, and only because three lookups must now answer one question.
Resolution is **role-dependent** — the same machineId resolves differently on a master than on a
secondary, which is exactly what makes the relay transparent to callers:

```ts
type Target =
  | { kind: 'direct'; url: string; token: string }              // reachable   — fetch
  | { kind: 'tunnel'; machineId: string }                       // NAT'd child — tunnelFetch
  | { kind: 'relay';  url: string; token: string; via: string } // peer        — fetch to hub, X-Target-Machine-Id
  | null;

resolveMachine(machineId, userId): Promise<Target>
```

Resolution order:

1. `pairedMasters` (`paired-masters/index.ts:26`) → `direct`. Existing behaviour, unchanged.
2. `machines` + a live tunnel → `tunnel`. New; this is master → secondary.
3. **Peer known via the master's peer list** → `relay`. New; this is secondary → secondary.

Step 3 needs no new fetching: `masterSyncService.getPeers(masterId)` (`master-sync/index.ts:42`)
already caches every peer the master reports, refreshed each sync from `GET /machines/me/peers`
(`machines.routes.ts:49`). A secondary therefore already knows B's id and name — it just has never
had anywhere to send a request for it. `relay` says: send to the *master's* URL with the master's
own machineToken, and name B in `X-Target-Machine-Id`.

### 4. The relay hop — `machineRelayPlugin` (master side, new)

On the master, a request authenticated by machineToken is currently promoted to a user session by
`machineTokenAuthPlugin` and served locally. Add a check ahead of that:

```
inbound request on master
  ├─ authenticated by machineToken (from secondary A)?
  ├─ carries X-Target-Machine-Id: B, and B ≠ this master?
  ├─ A.ownerUserId === B.ownerUserId?              ← same-owner check, mandatory
  ├─ X-Machine-Hops absent or 0?                   ← hop limit, mandatory
  └─▶ tunnelFetch(B, path, init) and stream the response back to A
      (otherwise: fall through and serve locally, exactly as today)
```

The relay reuses `tunnelFetch` verbatim — a relayed request and a master-originated request are
the same thing once the target is resolved. Total new logic: one guard and one call.

**Two invariants that are not optional:**

- **Hop limit.** The relay stamps `X-Machine-Hops: 1` outbound; B refuses to relay a request that
  already carries a hop count. Without this, two machines that are each other's peer can bounce a
  request forever. One hop is all a star topology ever needs.
- **Same-owner.** Both machines' `ownerUserId` must match (`machine-registry/index.ts:93`).
  A machineToken already grants full API access to *its own* owner's master; relaying without this
  check would let it reach machines it was never paired with.

### 5. Fan-out becomes mesh-wide

`fanOutToMachines` enumerates targets by resolution kind, so the aggregated sidebar is
role-appropriate without any per-role branching in the endpoint:

| Running on | Sections in the aggregate |
|---|---|
| **Master** | self + every online secondary (`tunnel`) |
| **Secondary A** | self + every paired master (`direct`) + every peer of that master (`relay`) |

Same endpoint, same merge logic (`merge.ts`), same `online: false` degradation for anything
unreachable. This is the point of routing everything through `resolveMachine`.

### 6. Call-site changes — still mechanical

| File:line | Today | Change |
|---|---|---|
| `fan-out.ts:16` | lists paired masters | enumerate all resolvable targets; rename `fanOutToMasters` → `fanOutToMachines` |
| `fan-out.ts:25` | `fetch(...)` | dispatch on `target.kind`: `fetch` / `tunnelFetch` / `fetch`+`X-Target-Machine-Id` |
| `machine-proxy.ts:90,102` | `pairedMastersService.get` + `fetch` | `resolveMachine` + the same three-way dispatch |
| `machine-proxy.ts:182` | `new WebSocket(toWsUrl(...))` | `tunnelWs` (tunnel) / relay-WS URL (relay) |
| `machine-token-auth` (master) | promotes token → user, serves locally | `machineRelayPlugin` guard ahead of it |

The three-way dispatch appears twice and is four lines each time. Worth a shared
`machineFetch(target, path, init)` helper rather than a third copy when the WS path lands.

The `allSettled`-style isolation in `fan-out.ts:37` already handles a dead machine; an offline
secondary is just another `online: false` row. `machine-proxy.ts:129`'s 502 path covers a dropped
tunnel unchanged.

### 5. UI — near zero

- `AppSidebar` renders whatever machine sections the aggregate returns. Secondaries appear as soon
  as fan-out includes them. **No component change.**
- `active-machine.ts` treats `machineId` as opaque — no change.
- `MachineSwitcher` (New Session / Projects) currently lists paired masters only; extend to the
  merged list so you can *start* work on a secondary.
- `MachinesSection.tsx:216` `MachineRow` gains an "Open" button — previously impossible
  (`2026-04-23…:119` explicitly says "No 'Open' button — locals aren't reachable"). That line in
  the old doc is what this design retires.

---

## Deliberately out of scope

- **Machines paired to *different* masters.** A and B only reach each other if they share a hub.
  Cross-hub routing means multi-hop and a real routing table — a different project. The UI should
  simply not offer a machine that does not resolve.
- **Direct secondary ↔ secondary (NAT traversal / STUN).** Every byte goes through the hub. Fine
  for API traffic and terminal I/O; would matter for bulk transfer, which this does not do.
- **Binary/streaming file transfer over `chunk` frames.** Base64 JSON is fine for API payloads;
  revisit if large downloads land on it.
- **Settings/rules sync.** Unchanged from the original design — machines stay independent.

---

## Risks, in the order they will actually bite

1. **Half-open sockets.** A NAT'd machine that vanishes leaves a socket that looks open. Ping/pong
   with a hard timeout is not optional; without it the master hangs requests at 8s (`fan-out.ts:4`)
   for a machine that is gone.
2. **Reconnect storms.** N secondaries reconnecting after a master restart, in lockstep. Jittered
   backoff from day one.
3. **In-flight request leaks.** Every pending `tunnelFetch` holds a promise resolver in a Map. A
   tunnel close must reject all of that machine's in-flight ids, and every request needs its own
   timeout. This is where the memory bug will be.
4. **Terminal WS through a multiplexed tunnel** is the hardest piece and worth building last, once
   plain request/response is proven. **Relayed** terminals (A→master→B) are harder still: two
   chained bridges, where the master pipes an inbound WS from A into a tunnel channel to B and
   must propagate closes in both directions. Budget for this being the piece that misbehaves.
5. **Version skew.** A new secondary against an old master (no tunnel route) must degrade to
   today's polling, not crash. Hence keeping the HTTP heartbeat for one release.
6. **Relay amplification.** Every relayed request occupies a slot on *two* hops and the hub's
   fan-out timeout (`fan-out.ts:4`) applies at each. A slow B now degrades A's sidebar too. Keep
   the relay timeout strictly shorter than the caller's so the hub fails before its caller does.
7. **Hop-limit and same-owner checks are load-bearing security**, not hygiene — see §4. They are
   the only thing standing between a valid machineToken and every machine on the hub.

---

## Phases

Each phase is independently shippable and leaves the system working.

1. **Protocol + master registry.** `protocol.ts`, `server.ts` with the WS route and connection map,
   ping/pong, in-flight timeouts. Unit-test framing and the reject-on-close path with a fake socket
   — no network needed.
2. **Secondary client.** `client.ts` with reconnect/backoff and `app.handle()` dispatch;
   `machineTunnelAuthPlugin`. Heartbeat moves onto the socket, HTTP path retained.
   *Checkpoint: master's `MachinesSection` shows a secondary online via socket liveness.*
3. **`resolveMachine` + fan-out (`direct` + `tunnel`).** Aggregated sidebar and notifications
   include secondaries.
   *Checkpoint: master's sidebar shows all three machines' sessions.* ← **this is the reported bug**
4. **HTTP proxy.** `machine-proxy.ts` transport switch. Clicking a secondary's session opens it:
   files, git, session detail all work through the existing `X-Machine-Id` path.
5. **Relay (`machineRelayPlugin` + `relay` resolution).** Hop limit and same-owner checks first,
   then the forward. Unit-test the guard matrix (wrong owner, hop already set, self-target,
   unknown target) before anything else — it is pure logic and needs no network.
   *Checkpoint: secondary A's sidebar shows B's sessions, and opening one works.*
6. **WS.** `tunnelWs` for live terminals on a secondary (master→B), then the chained relay bridge
   (A→master→B).
7. **UI polish.** "Open" on `MachineRow`, full mesh in `MachineSwitcher`, and hiding machines that
   do not resolve from the current machine.

Phases 1–4 are testable with two dev servers on different ports. **Phase 5 needs three**, since a
relay with only two machines never exercises the hop that matters — worth wiring up a third local
instance rather than waiting on hardware. End-to-end confidence still needs your real setup, the
same limit the previous doc hit (`2026-06-03…:103`).

---

## What the build actually hit

Three things the design got wrong, recorded so the next person doesn't re-derive them:

1. **`app.handle()` does not work for tunnelled requests.** The design claimed in-process dispatch
   would avoid "no loopback port, no second auth hop." In practice the returned promise never
   settled. The client now issues a loopback `fetch` to its own port
   (`index.ts` → `dispatch: (request) => fetch(request)`), which has the side benefit of
   guaranteeing the request traverses exactly the middleware a normal client request would.

2. **The hub must send on `ws.raw`, not the ElysiaWS wrapper.** Elysia builds a new wrapper per
   event, so the one captured in `open()` is stale by the time the tunnel sends an *unsolicited*
   frame — which, unlike the existing proxy, is the tunnel's normal mode of operation.
   `machine-proxy.ts:143` documents this hazard for Map keys; here it silently drops sends.

3. **`GET /api/sessions/sidebar` hangs on a fresh local DB — on `main`, unrelated to this work.**
   Verified by stashing every change and reproducing on a clean checkout. Every other endpoint
   answers in <10ms. This matters here because `/sessions/sidebar/aggregate` fans out to it, so
   the aggregated sidebar inherits the hang once any machine is reachable. **Worth its own fix**;
   the earlier multi-machine doc already recorded a separate crash in the same builder
   (`2026-06-03…:95`, invalid `lastActiveAt`), so this looks like a second failure mode there.

## Lazy version, if you only want to *see* the mesh

If the goal is just "every machine's sidebar lists what every other machine is running", skip the
tunnel and the relay entirely: extend the existing heartbeat body to include the secondary's
`buildSidebarData()` output, cache it on the master in the `machines` row, and serve it two ways —
the master reads the cache directly, and a secondary gets every peer's cached blob appended to the
`GET /machines/me/peers` response it already polls (`machines.routes.ts:49`).

The hub still brokers; it just brokers *stale state* instead of *live requests*, and the direction
problem disappears because every machine is only ever pulling from the master it can already reach.

~80 lines, no tunnel, no relay, no hop limits, no new failure modes. Ceiling: read-only and up to
30s stale — no terminals, no opening a remote session, no control. It replaces Phases 1–6 with an
afternoon.

**This is the fork in the plan.** If "access" means *see what's running everywhere*, take this and
stop. If it means *drive a session on any machine from any machine*, the tunnel and the relay are
both load-bearing and there is no smaller version of them.
