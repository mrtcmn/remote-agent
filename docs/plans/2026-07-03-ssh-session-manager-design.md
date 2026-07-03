# SSH Session Manager — Design

Date: 2026-07-03
Status: Approved for planning

A Termius-style SSH session manager integrated into remote-agent: store hosts,
groups/tags, and reusable credentials (keys/passwords); connect over xterm with
auto-reconnect; per-host connection logs. SSH connections originate from the
**API server** (Bun) and reuse the existing **session + terminal** model — an
SSH connection is just a special session type, not a parallel stack.

## Decisions (locked)

| Question | Decision |
|---|---|
| Where SSH runs | API server (Bun), ssh2 client, streamed to xterm over WebSocket |
| Secret storage | AES-256-GCM at rest; master key **auto-generated on first run**, stored on disk `0600` (no env var) |
| v1 scope | Core host+auth, groups/folders+tags, SFTP + port-forwarding |
| Deferred | Jump host / ProxyJump; full session recording |
| Logs | Connection/event log (connect, disconnect, auth_fail, retry, error) |
| Reconnect | Auto retry with exponential backoff; never retry a user-initiated close |
| Operating model | SSH = a session of type `ssh` owning a terminal of type `ssh` — reuse existing machinery |

## Dependency

- `ssh2` (server only). SFTP and tunnels are built in — no other new dep.
- Crypto is `node:crypto` (no dep). UI reuses existing Tailwind/Radix/lucide/motion + xterm.

## Data model

Added to both `db/schema.pg.ts` and `db/schema.sqlite.ts`.

- **`ssh_credentials`** — reusable vault.
  `id, name, type('password'|'key'), encPassword, encPrivateKey, encPassphrase, createdAt`.
  `enc*` columns hold AES-256-GCM blobs (`iv|authTag|ciphertext`). **Write-only over
  the API** — secret material is never returned to the client.
- **`ssh_hosts`** —
  `id, label, host, port(default 22), username, authType('password'|'key'|'agent'),
  credentialId → ssh_credentials, groupId → ssh_groups (nullable), tags (text/json),
  knownHostFp (nullable), color? , createdAt`.
- **`ssh_groups`** — `id, name, parentId (nullable, self-ref), sortOrder`. Termius-style folders.
- **`ssh_log_events`** —
  `id, hostId, sessionId (nullable), type('connect'|'disconnect'|'auth_fail'|'retry'|'error'),
  message, createdAt`. Never stores secrets.

Existing tables touched:
- `claude_sessions`: add nullable `sshHostId` (which host a session is for) and allow a
  `type`/`kind` marker of `ssh` (reuse existing status: active | waiting_input | paused | terminated).
- `terminals`: `TerminalType` gains `'ssh'`.

## Master key & crypto

`services/crypto/secret-box.ts` (~30 lines, `node:crypto`):

- On first run, generate 32 random bytes → write to data dir as `secret.key`, mode `0600`.
  Fall back to an `app_settings` row if the dir is not writable.
- `encrypt(plaintext) -> blob` / `decrypt(blob) -> plaintext` using `aes-256-gcm`.
- Decryption happens **only** at connect time, inside the API process. Never logged,
  never sent to the client.
- Self-check: a `demo()`/`__main__` asserting `decrypt(encrypt(x)) === x` and that a
  tampered blob throws (GCM auth).

## Operating model — SSH as a special session

Today a `claude_session` owns `terminals`; each terminal has a backing Bun PTY; and
`terminal-websocket.ts` streams it to xterm. SSH is the **same shape** — the only
difference is the terminal's backing is an ssh2 shell stream instead of a Bun subprocess.

- Add `'ssh'` to `TerminalType`.
- Give `TerminalInstance` a small backing adapter: `{ write(data), resize(cols, rows), close() }`.
  `write` / `resize` / `closeTerminal` / `handleOutput` / `handleExit` in
  `TerminalService` become backing-agnostic. Two real backings (Bun PTY, ssh2 stream)
  justify the one small interface — nothing speculative.
- Startup reconciliation (already marks running terminals `exited`, active sessions
  `paused`) applies to SSH sessions for free.

## Connect flow — `SshService.connect(hostId)`

1. Load host → resolve `credentialId` → `decrypt()` the secret.
2. `ssh2.Client.connect({ host, port, username, password | privateKey+passphrase | agent })`.
3. **Host-key check (TOFU):** first connect stores the server fingerprint in
   `knownHostFp`; on later connects a mismatch **refuses** and surfaces a warning
   (MITM boundary — not skipped).
4. `client.shell({ cols, rows })` → wire `stream` `data` into `handleOutput`;
   `stream`/`client` `close`/`error` into the reconnect/exit path.
5. Reuse the existing in-memory + DB scrollback.

## Reconnect (auto, backoff)

- On a drop that was **not** a user `closeTerminal`: retry `1s → 2s → 4s → 8s …`,
  cap ~30s, max ~10 attempts.
- Emit a `reconnecting` WS event → xterm shows an overlay "Reconnecting… attempt N"
  with a **Cancel** button; success clears it.
- Each attempt writes a `retry` log event. A user-initiated close never retries.

## Logs

- Every connect / disconnect / auth_fail / retry / error → one `ssh_log_events` row
  (host + user context, never secrets).
- `/ws/ssh/:sessionId` also forwards `log` events live.
- A per-host log drawer reads history via REST.

## API surface

- **WebSocket** `/ws/ssh/:sessionId` — mirrors `terminal-websocket.ts`:
  in: `input`, `resize`, `ping`; out: `connected`, `output`, `scrollback`, `exit`,
  `reconnecting`, `log`, `error`.
- **REST** `ssh.routes.ts`:
  - CRUD `ssh_hosts`, `ssh_groups`, `ssh_credentials` (secrets write-only).
  - `GET /ssh/hosts/:id/logs` — event history.
  - `POST /ssh/hosts/:id/connect` → creates session + terminal, returns `sessionId`.
  - `POST /ssh/sessions/:id/stop`.
  - SFTP (thin, rides the live client): `GET /ssh/:sessionId/sftp/list`, `.../download`, `POST .../upload`.
  - Port forwarding: `POST /ssh/:sessionId/forward` (local/remote tunnel bound to the session).

## UI / design language

Match the existing system — no new fonts, no new aesthetic. Dark-first shadcn tokens,
signature **orange primary `18 95% 56%`** as the *live-connection* signal, Tailwind +
Radix + lucide + `motion`, SF Mono in the terminal. Reuse `components/Terminal.tsx`
pointed at the SSH socket.

- **Host tree panel** (new sidebar section, styled like `MachinesSection`): groups →
  hosts, collapsible; tag filter chips; per-host status dot (muted = idle, orange =
  connected, destructive = auth/host-key error). Right-click context menu (Radix
  context-menu, already used) → Connect / Edit / Logs / Delete.
- **Host editor** (Radix dialog): label, host, port, username, auth type, credential
  picker (or "new credential" inline), group, tags. Validation at the form boundary.
- **Credential vault** (dialog): list names/types only; add/replace secret (write-only
  field, never pre-filled).
- **Terminal view**: existing xterm; a `motion` reconnect overlay (fade + subtle pulse
  on the orange accent) with attempt counter + Cancel.
- **Log drawer**: per-host timeline, monospaced, color-coded by event type
  (destructive for auth_fail/error, muted for connect/disconnect, primary for retry).

Cohesion over novelty: the one memorable touch is the orange "live" pulse tying a
connected host in the tree to its terminal — no decorative noise.

## Security notes (not simplified away)

- Secrets: AES-256-GCM at rest, decrypted only at connect time, never returned/logged.
- Host-key TOFU verification; refuse on fingerprint change.
- Input validation on all host/credential forms (trust boundary).
- Logs carry host/user context only — never key/password material.

## Deferred (YAGNI until asked)

- Jump host / ProxyJump.
- Full terminal-session recording/replay.
- External secret managers (Vault/KMS) and master-key rotation UI.

## Build order

1. `secret-box.ts` + self-check.
2. Schema (both dialects) + migration; `ssh` terminal type; `sshHostId` on session.
3. Backing adapter in `TerminalService`.
4. `SshService.connect` + TOFU + reconnect/backoff + log events.
5. `/ws/ssh/:sessionId` route.
6. `ssh.routes.ts` (CRUD, connect/stop, logs). SFTP + forward last.
7. UI: host tree → editor → vault → reconnect overlay → log drawer.
