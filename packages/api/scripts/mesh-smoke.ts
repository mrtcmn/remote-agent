/**
 * Three-instance mesh smoke test: hub + secondary A + secondary B.
 *
 * Verifies the thing unit tests cannot: that A can see and reach B by relaying
 * through the hub. Each instance gets its own HOME (⇒ its own SQLite db) and port.
 */
import { spawn, type Subprocess } from 'bun';
import { mkdirSync, rmSync } from 'node:fs';
import { userInfo, tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const TMP = join(tmpdir(), 'ra-mesh-smoke');
const EMAIL = `${userInfo().username}@local.machine`;
const PASSWORD = 'local-mode';

interface Node { name: string; port: number; home: string; proc?: Subprocess; cookie?: string; }

// Fresh ports per run so an orphaned server from a previous run cannot make
// the new one fail to bind (which looks like ConnectionRefused later).
const BASE = 15000 + Math.floor(Math.random() * 3000);
const nodes: Record<string, Node> = {
  hub: { name: 'hub', port: BASE, home: join(TMP, 'hub') },
  a:   { name: 'secA', port: BASE + 1, home: join(TMP, 'a') },
  b:   { name: 'secB', port: BASE + 2, home: join(TMP, 'b') },
};

const log = (...args: unknown[]) => console.log('  ', ...args);

async function boot(node: Node): Promise<void> {
  mkdirSync(node.home, { recursive: true });

  // Fresh HOME ⇒ fresh SQLite file ⇒ needs the schema before boot.
  const migrate = spawn({
    cmd: ['bun', 'run', 'src/db/migrate.ts'],
    cwd: join(ROOT, 'packages/api'),
    env: { ...process.env, HOME: node.home, RA_MODE: 'local' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await migrate.exited;
  if (code !== 0) {
    throw new Error(`${node.name} migration failed: ${await new Response(migrate.stderr as ReadableStream).text()}`);
  }

  node.proc = spawn({
    cmd: ['bun', 'run', 'src/index.ts'],
    cwd: join(ROOT, 'packages/api'),
    env: {
      ...process.env,
      HOME: node.home,
      RA_MODE: 'local',
      RA_PORT: String(node.port),
      CORS_ORIGIN: '*',
      APP_URL: `http://127.0.0.1:${node.port}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Surface tunnel/relay logs and anything that looks like a failure.
  for (const stream of ['stdout', 'stderr'] as const) {
    (async () => {
      for await (const chunk of node.proc![stream] as ReadableStream) {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n')) {
          if (/DEBUG|tunnel|relay|error|throw|Cannot|undefined is not/i.test(line) && line.trim()) {
            console.log(`   [${node.name}:${stream}] ${line.trim().slice(0, 200)}`);
          }
        }
      }
    })();
  }

  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${node.port}/health`);
      if (res.ok) { log(`${node.name} up on ${node.port}`); return; }
    } catch { /* not yet */ }
    await Bun.sleep(250);
  }
  const stderr = await new Response(node.proc.stderr as ReadableStream).text();
  throw new Error(`${node.name} failed to boot:\n${stderr.slice(0, 2000)}`);
}

async function login(node: Node): Promise<void> {
  // /health can answer before the seeded user is committed; retry briefly.
  let last = '';
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://127.0.0.1:${node.port}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.ok) {
      const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      if (cookie) { node.cookie = cookie; log(`${node.name} authenticated`); return; }
      last = 'no cookie';
    } else {
      last = `${res.status} ${(await res.text()).slice(0, 100)}`;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${node.name} login failed: ${last}`);
}

function api(node: Node, path: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${node.port}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: node.cookie ?? '', ...(init.headers ?? {}) },
  });
}

async function pair(secondary: Node, hub: Node): Promise<string> {
  const tokenRes = await api(hub, '/machines/pairing-token', { method: 'POST' });
  if (!tokenRes.ok) throw new Error(`pairing-token failed: ${await tokenRes.text()}`);
  const { token } = await tokenRes.json() as { token: string };

  // One `name` serves both sides; use the secondary's name so the hub's
  // machine list has distinct labels.
  const pairRes = await api(secondary, '/paired-masters', {
    method: 'POST',
    body: JSON.stringify({ url: `http://127.0.0.1:${hub.port}`, token, name: secondary.name }),
  });
  if (!pairRes.ok) throw new Error(`${secondary.name} pair failed: ${await pairRes.text()}`);
  const { master } = await pairRes.json() as { master: { id: string } };
  log(`${secondary.name} paired with hub (machineId ${master.id.slice(0, 8)})`);
  return master.id;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  rmSync(TMP, { recursive: true, force: true });
  console.log('\n── booting three instances ──');
  await boot(nodes.hub);
  await Promise.all([boot(nodes.a), boot(nodes.b)]);
  await Promise.all([login(nodes.hub), login(nodes.a), login(nodes.b)]);

  console.log('\n── pairing ──');
  await pair(nodes.a, nodes.hub);
  await pair(nodes.b, nodes.hub);

  console.log('\n── waiting for tunnels + peer sync ──');
  await Bun.sleep(6000);

  // 1. Hub sees both secondaries online (tunnel liveness).
  const machinesRes = await api(nodes.hub, '/machines');
  const { machines } = await machinesRes.json() as {
    machines: { id: string; name: string; online: boolean }[];
  };
  const onlineIds = machines.filter((m) => m.online).map((m) => m.id);
  check('hub sees both secondaries online', onlineIds.length === 2,
    `${onlineIds.length}/2 online of ${machines.length} paired`);

  // 2. Hub → secondary over the tunnel (master-to-secondary reachability).
  const secAId = machines[0]?.id;
  const hubToSec = await api(nodes.hub, '/projects', {
    headers: { 'x-machine-id': secAId },
  });
  const hubToSecBody = await hubToSec.text();
  check('hub reaches a secondary over its tunnel', hubToSec.ok,
    `HTTP ${hubToSec.status} ${hubToSec.ok ? `${hubToSecBody.length}b` : hubToSecBody.slice(0, 160)}`);

  // 3. Hub's aggregate includes the secondaries (the originally reported bug).
  //    Uses /notifications/aggregate, not the sidebar one: /sessions/sidebar
  //    hangs on a fresh DB on main (pre-existing, unrelated to the mesh), and
  //    the sidebar aggregate fans out to it.
  const hubAggRes = await api(nodes.hub, '/notifications/aggregate');
  const hubAgg = await hubAggRes.json() as {
    machines: { machineId: string; machineName: string; online: boolean; error?: string }[];
  };
  check('hub aggregate lists self + 2 secondaries', hubAgg.machines?.length === 3,
    `${hubAgg.machines?.length} sections: ${hubAgg.machines?.map((m) => `${m.machineName}:${m.online}${m.error ? `(${m.error})` : ''}`).join(' ')}`);

  // 4. A discovers B as a peer through the hub.
  //    A syncs its peer list on a 30s tick, and B paired *after* A's initial
  //    sync — so poll rather than assuming a fixed wait is long enough.
  type Agg = { machines: { machineId: string; machineName: string; online: boolean; error?: string }[] };
  let aAgg: Agg = { machines: [] };
  for (let i = 0; i < 24; i++) {
    aAgg = await (await api(nodes.a, '/notifications/aggregate')).json() as Agg;
    if (aAgg.machines?.length >= 3) break;
    await Bun.sleep(2500);
  }
  check('secA aggregate lists self + hub + peer B', aAgg.machines?.length === 3,
    `${aAgg.machines?.length} sections: ${aAgg.machines?.map((m) => `${m.machineName}:${m.online}${m.error ? `(${m.error})` : ''}`).join(' ')}`);

  // 5. THE RELAY: A explicitly addresses B, routed A → hub → B.
  const peerB = aAgg.machines?.find((m) => m.machineId !== 'self' && m.machineName === 'secB');
  if (peerB) {
    const relayRes = await api(nodes.a, '/projects', {
      headers: { 'x-machine-id': peerB.machineId },
    });
    const body = await relayRes.text();
    check('secA reaches peer B by relaying through hub', relayRes.ok,
      `HTTP ${relayRes.status} ${relayRes.ok ? `${body.length}b` : body.slice(0, 120)}`);
  } else {
    check('secA reaches peer B by relaying through hub', false, 'peer B not discovered');
  }

  // 6. Loop guard: a request already marked as relayed must be refused.
  const loopRes = await fetch(`http://127.0.0.1:${nodes.hub.port}/api/projects`, {
    headers: {
      cookie: nodes.hub.cookie!,
      'x-target-machine-id': secAId,
      'x-machine-hops': '1',
    },
  });
  check('hop limit refuses an already-relayed request', loopRes.status === 508,
    `HTTP ${loopRes.status}`);

  // 7. Unknown target is refused rather than served locally.
  const unknownRes = await fetch(`http://127.0.0.1:${nodes.hub.port}/api/projects`, {
    headers: { cookie: nodes.hub.cookie!, 'x-target-machine-id': 'no-such-machine' },
  });
  check('unknown relay target is refused', unknownRes.status === 404,
    `HTTP ${unknownRes.status}`);

  // 8. The sidebar aggregate — what the UI actually renders. Give secA a
  //    project so an empty section can't pass for a working one.
  const projRes = await api(nodes.a, '/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'smoke-proj', localPath: nodes.a.home }),
  });
  log(`secA project create: HTTP ${projRes.status} ${(await projRes.text()).slice(0, 120)}`);

  const sidebarRes = await api(nodes.hub, '/sessions/sidebar/aggregate');
  const sidebarText = await sidebarRes.text();
  let sidebar: { machines?: { machineName: string; online: boolean; error?: string; data?: { projects: { name: string }[] } }[] } = {};
  try { sidebar = JSON.parse(sidebarText); } catch { /* not json */ }
  const secASection = sidebar.machines?.find((m) => m.machineName === 'secA');
  check('hub sidebar aggregate shows secA project', !!secASection?.data?.projects?.some((p) => p.name === 'smoke-proj'),
    sidebarRes.ok
      ? sidebar.machines?.map((m) => `${m.machineName}:${m.online}${m.error ? `(${m.error})` : ''}[${m.data?.projects?.length ?? '-'}p]`).join(' ')
      : `HTTP ${sidebarRes.status} ${sidebarText.slice(0, 160)}`);

  console.log('\n── summary ──');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}

try {
  await main();
} catch (err) {
  console.error('\n💥', err);
  process.exitCode = 1;
} finally {
  for (const node of Object.values(nodes)) node.proc?.kill();
  await Bun.sleep(300);
}
