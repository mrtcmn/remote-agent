import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBase } from '@/lib/api-config';
import { pcm16ToFloat } from '@/lib/soniox';

/** Must match TTS_SAMPLE_RATE in assistant.routes.ts. */
const TTS_SAMPLE_RATE = 24000;

export interface AssistantStep {
  id: string;
  tool: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  output?: string;
}

export interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  steps: AssistantStep[];
  pending?: boolean;
  /** Started by an agent update, not typed or said by the user. */
  auto?: boolean;
  error?: string;
}

/** Said the moment the operator reaches for a tool, so silence never means "dead". */
const FILLERS: Record<string, string[]> = {
  en: ['Let me check.', 'One sec, checking.', 'On it, looking now.', 'Give me a second.'],
  tr: ['Bir saniye, bakıyorum.', 'Hemen kontrol ediyorum.', 'Bakıyorum, bir dakika.'],
};

/** Typed input has no detected language. ponytail: Turkish letters → tr, else en; add a detector if more languages matter. */
const guessLanguage = (s: string) => (/[çğışöüÇĞİŞÖÜ]/.test(s) ? 'tr' : 'en');

const uid = () => Math.random().toString(36).slice(2);

/**
 * The operator conversation: text in, SSE of tool steps + reply out, and the
 * reply spoken through Soniox TTS. `sessionId` is the claude conversation the
 * server resumes, so follow-ups ("and the other one?") keep context.
 */
export function useAssistant() {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const sessionRef = useRef<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // ─── Voice out: streamed PCM, played chunk by chunk as Soniox generates it.
  // A serial queue keeps the filler and the reply from overlapping; each line's
  // request starts at once, so the reply buffers while the filler plays.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const voiceAbortRef = useRef(new AbortController());
  const voiceGenRef = useRef(0);
  // Queued + playing lines. `speaking` covers the TTS fetch too, so hands-free
  // mode doesn't reopen the mic in the gap before the reply's audio arrives.
  const queuedRef = useRef(0);

  const stopSpeaking = useCallback(() => {
    voiceGenRef.current++;
    voiceAbortRef.current.abort(); // stop Soniox generating what nobody will hear
    voiceAbortRef.current = new AbortController();
    for (const src of sourcesRef.current) {
      try { src.stop(); } catch {}
    }
    sourcesRef.current.clear();
    queueRef.current = Promise.resolve();
    queuedRef.current = 0;
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, language: string) => {
    if (mutedRef.current || !text.trim()) return;
    const gen = voiceGenRef.current;
    const live = () => gen === voiceGenRef.current;
    queuedRef.current++;
    setSpeaking(true);

    // Read the stream eagerly into `chunks`; the player drains it when it's this line's turn.
    const chunks: Uint8Array[] = [];
    let ended = false;
    let wake = () => {};
    const pump = fetch(`${getApiBase()}/api/assistant/speak`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
      signal: voiceAbortRef.current.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Voice failed (${res.status})`);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          wake();
        }
      })
      .finally(() => {
        ended = true;
        wake();
      });
    pump.catch(() => {}); // surfaced by play(), not as an unhandled rejection

    const play = async () => {
      if (!live()) return;
      const ctx = (audioCtxRef.current ??= new AudioContext({ sampleRate: TTS_SAMPLE_RATE }));
      await ctx.resume().catch(() => {});
      let at = ctx.currentTime + 0.05;
      let carry: Uint8Array | null = null;
      let i = 0;
      try {
        for (;;) {
          if (!live()) return;
          if (i < chunks.length) {
            const { samples, carry: rest } = pcm16ToFloat(carry, chunks[i++]);
            carry = rest;
            if (!samples.length) continue;
            const buf = ctx.createBuffer(1, samples.length, TTS_SAMPLE_RATE);
            buf.copyToChannel(samples, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            // A late chunk starts now rather than in the past (that would clip it).
            at = Math.max(at, ctx.currentTime);
            src.start(at);
            at += buf.duration;
            sourcesRef.current.add(src);
            src.onended = () => sourcesRef.current.delete(src);
          } else if (ended) {
            await pump; // rethrows a failed request
            break;
          } else {
            await new Promise<void>((r) => (wake = r));
          }
        }
        setVoiceError(null);
      } catch (e) {
        if (live()) setVoiceError((e as Error).message);
        return;
      }
      // Hold the queue until the last scheduled chunk has actually played.
      while (live() && ctx.currentTime < at) await new Promise((r) => setTimeout(r, 50));
    };

    queueRef.current = queueRef.current.then(play).finally(() => {
      if (!live()) return; // stopSpeaking() already reset the count
      queuedRef.current = Math.max(0, queuedRef.current - 1);
      if (!queuedRef.current) setSpeaking(false);
    });
  }, []);

  // ─── Conversation ─────────────────────────────────────────────────────────
  const patchLast = (fn: (t: AssistantTurn) => AssistantTurn) =>
    setTurns((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  /** `language` comes from speech-to-text; typed text falls back to a guess. */
  const lastLangRef = useRef('en');
  const ask = useCallback(async (text: string, language?: string, opts: { auto?: boolean } = {}) => {
    const q = text.trim();
    if (!q) return;
    const lang = language ?? (opts.auto ? lastLangRef.current : guessLanguage(q));
    if (!opts.auto) lastLangRef.current = lang;
    abortRef.current?.abort();
    stopSpeaking();
    const controller = new AbortController();
    abortRef.current = controller;

    setTurns((prev) => [
      ...prev,
      { id: uid(), role: 'user', text: q, steps: [], auto: opts.auto },
      { id: uid(), role: 'assistant', text: '', steps: [], pending: true },
    ]);
    setBusy(true);
    let saidFiller = false;

    const handle = (ev: any) => {
      switch (ev.type) {
        case 'session':
          sessionRef.current = ev.sessionId;
          break;
        case 'step':
          if (!saidFiller) {
            saidFiller = true;
            const lines = FILLERS[lang] ?? FILLERS.en;
            speak(lines[Math.floor(Math.random() * lines.length)], lang);
          }
          patchLast((t) => ({ ...t, steps: [...t.steps, { id: ev.id, tool: ev.tool, input: ev.input, status: 'running' }] }));
          break;
        case 'step_done':
          patchLast((t) => ({
            ...t,
            steps: t.steps.map((s) => (s.id === ev.id ? { ...s, status: ev.ok ? 'done' : 'error', output: ev.output } : s)),
          }));
          break;
        case 'text':
          // Interim narration between tool calls; the final `done` replaces it.
          patchLast((t) => ({ ...t, text: ev.text }));
          break;
        case 'done':
          if (ev.sessionId) sessionRef.current = ev.sessionId;
          patchLast((t) => ({ ...t, text: ev.text, pending: false }));
          speak(ev.text, lang);
          break;
        case 'error':
          patchLast((t) => ({ ...t, pending: false, error: ev.message }));
          break;
      }
    };

    try {
      const res = await fetch(`${getApiBase()}/api/assistant/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q, sessionId: sessionRef.current }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (data) {
            try { handle(JSON.parse(data)); } catch { /* skip a bad frame */ }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) patchLast((t) => ({ ...t, error: (e as Error).message }));
    } finally {
      patchLast((t) => (t.pending ? { ...t, pending: false } : t));
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [speak, stopSpeaking]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    stopSpeaking();
  }, [stopSpeaking]);

  const reset = useCallback(() => {
    cancel();
    sessionRef.current = undefined;
    setTurns([]);
  }, [cancel]);

  // ─── Agent updates: "the agent you messaged finished" → an automatic turn.
  // Queued while a turn runs or the operator talks, so it never cuts anyone off.
  const autoQueueRef = useRef<string[]>([]);
  const busyRef = useRef(busy || speaking);
  busyRef.current = busy || speaking;
  const askRef = useRef(ask);
  askRef.current = ask;

  const drainAuto = useCallback(() => {
    if (busyRef.current) return;
    const next = autoQueueRef.current.shift();
    if (next) askRef.current(next, undefined, { auto: true });
  }, []);

  useEffect(() => {
    if (!busy && !speaking) drainAuto();
  }, [busy, speaking, drainAuto]);

  useEffect(() => {
    const es = new EventSource(`${getApiBase()}/api/assistant/events`, { withCredentials: true });
    es.onmessage = (ev) => {
      let u: { kind: string; project?: string; machine?: string; sessionId: string; title: string; body: string };
      try { u = JSON.parse(ev.data); } catch { return; }
      const what = u.kind === 'task_complete' ? 'finished' : u.kind === 'error' ? 'hit an error' : 'needs input';
      const where = [u.project, u.machine && `on ${u.machine}`].filter(Boolean).join(' ') || 'a session';
      autoQueueRef.current.push(
        `[agent update] The agent in ${where} ${what} (session ${u.sessionId}). Hook summary: ${u.title} — ${u.body}. Read the session and report to me briefly.`
      );
      drainAuto();
    };
    // EventSource reconnects by itself after a drop (server restart, sleep).
    return () => es.close();
  }, [drainAuto]);

  return { turns, busy, speaking, muted, setMuted, voiceError, ask, cancel, reset, stopSpeaking };
}
