import { describe, expect, test } from 'bun:test';
import { machineTunnel, type TunnelSocket } from './server';
import { decodeFrame, bytesToBase64, type Frame } from './protocol';

/** Fake socket: records what the server sent, no network involved. */
function fakeSocket() {
  const sent: Frame[] = [];
  let closed: { code?: number; reason?: string } | null = null;
  const socket: TunnelSocket = {
    send: (data) => { const f = decodeFrame(data); if (f) sent.push(f); },
    close: (code, reason) => { closed = { code, reason }; },
  };
  return {
    socket,
    sent,
    get closed() { return closed; },
    last: () => sent[sent.length - 1],
  };
}

/**
 * Attach a rejection handler immediately. These promises are rejected
 * synchronously by teardown, before an `await expect(...)` could subscribe —
 * which Bun would report as an unhandled rejection.
 */
function settle(p: Promise<unknown>): Promise<Error | null> {
  return p.then(() => null, (err: Error) => err);
}

describe('tunnel request/response', () => {
  test('round-trips a response body and status', async () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-ok', fake.socket);

    const promise = machineTunnel.fetch('m-ok', '/api/sessions', { method: 'GET' });

    const req = fake.last();
    expect(req.t).toBe('req');
    expect(req).toMatchObject({ method: 'GET', path: '/api/sessions' });

    machineTunnel.handleFrame(conn, JSON.stringify({
      t: 'res',
      id: (req as Extract<Frame, { t: 'req' }>).id,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: bytesToBase64(new TextEncoder().encode('{"ok":true}')),
    }));

    const res = await promise;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    machineTunnel.unregister('m-ok', fake.socket);
  });

  test('an err frame rejects only its own request', async () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-err', fake.socket);

    const failing = settle(machineTunnel.fetch('m-err', '/api/a'));
    const other = settle(machineTunnel.fetch('m-err', '/api/b'));
    const failingId = (fake.sent[0] as Extract<Frame, { t: 'req' }>).id;

    machineTunnel.handleFrame(conn, JSON.stringify({ t: 'err', id: failingId, message: 'boom' }));

    expect((await failing)?.message).toBe('boom');
    expect(conn.pending.size).toBe(1); // `other` still in flight

    machineTunnel.unregister('m-err', fake.socket);
    expect((await other)?.message).toBe('Tunnel closed');
  });
});

describe('teardown', () => {
  // The leak this guards: without teardown, every in-flight request keeps its
  // resolver forever and the caller hangs until its own timeout.
  test('closing the tunnel rejects all in-flight requests and clears them', async () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-drop', fake.socket);

    const a = settle(machineTunnel.fetch('m-drop', '/api/a'));
    const b = settle(machineTunnel.fetch('m-drop', '/api/b'));
    expect(conn.pending.size).toBe(2);

    machineTunnel.unregister('m-drop', fake.socket);

    expect((await a)?.message).toBe('Tunnel closed');
    expect((await b)?.message).toBe('Tunnel closed');
    expect(conn.pending.size).toBe(0);
    expect(machineTunnel.isOnline('m-drop')).toBe(false);
  });

  test('reconnect replaces the old connection and fails its in-flight work', async () => {
    const first = fakeSocket();
    machineTunnel.register('m-re', first.socket);
    const stale = settle(machineTunnel.fetch('m-re', '/api/a'));

    const second = fakeSocket();
    machineTunnel.register('m-re', second.socket);

    expect((await stale)?.message).toBe('Replaced by a newer connection');
    expect(first.closed).toMatchObject({ code: 4000 });
    expect(machineTunnel.isOnline('m-re')).toBe(true);

    // A stale close event must not evict the live connection.
    machineTunnel.unregister('m-re', first.socket);
    expect(machineTunnel.isOnline('m-re')).toBe(true);

    machineTunnel.unregister('m-re', second.socket);
  });

  test('fetch on an unknown machine rejects rather than hanging', async () => {
    await expect(machineTunnel.fetch('nobody', '/api/a')).rejects.toThrow('not connected');
  });
});

describe('ws channels', () => {
  test('bridges messages and closes the channel from the far side', () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-ws', fake.socket);

    const received: (string | Uint8Array)[] = [];
    const closes: number[] = [];
    const channel = machineTunnel.openWs('m-ws', '/ws/terminal/1', {
      onMessage: (d) => received.push(d),
      onClose: (code) => { closes.push(code); },
    });

    const opened = fake.sent.find((f) => f.t === 'wsopen') as Extract<Frame, { t: 'wsopen' }>;
    expect(opened.path).toBe('/ws/terminal/1');

    channel.send('hello');
    expect(fake.last()).toMatchObject({ t: 'wsmsg', data: 'hello', binary: false });

    machineTunnel.handleFrame(conn, JSON.stringify({ t: 'wsmsg', id: opened.id, data: 'world' }));
    expect(received).toEqual(['world']);

    machineTunnel.handleFrame(conn, JSON.stringify({ t: 'wsclose', id: opened.id, code: 1000 }));
    expect(closes).toEqual([1000]);

    machineTunnel.unregister('m-ws', fake.socket);
  });
});

describe('heartbeat', () => {
  test('records stats and answers pings', () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-hb', fake.socket);

    machineTunnel.handleFrame(conn, JSON.stringify({ t: 'heartbeat', sessionCount: 7, version: '2.1' }));
    expect(machineTunnel.stats('m-hb')).toEqual({ sessionCount: 7, version: '2.1' });

    machineTunnel.handleFrame(conn, JSON.stringify({ t: 'ping' }));
    expect(fake.last()).toEqual({ t: 'pong' });

    machineTunnel.unregister('m-hb', fake.socket);
  });

  test('malformed frames are ignored, not thrown', () => {
    const fake = fakeSocket();
    const conn = machineTunnel.register('m-bad', fake.socket);

    expect(() => machineTunnel.handleFrame(conn, 'not json')).not.toThrow();
    expect(() => machineTunnel.handleFrame(conn, JSON.stringify({ nope: 1 }))).not.toThrow();
    expect(() => machineTunnel.handleFrame(conn, null)).not.toThrow();

    machineTunnel.unregister('m-bad', fake.socket);
  });
});
