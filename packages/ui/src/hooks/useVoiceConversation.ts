import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBase } from '@/lib/api-config';
import { floatToPcm16, foldUtterances, type SonioxFrame, type SonioxToken, type Utterance } from '@/lib/soniox';

const SONIOX_WS = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MODEL = 'stt-rt-v5';
/** Soniox closes a silent socket after 20s; we ping well inside that. */
const KEEPALIVE_MS = 8000;
/** Hands-free mode costs per minute of audio: end it when nobody talks. */
const IDLE_STOP_MS = 60_000;

/**
 * Hands-free conversation: one Soniox socket with semantic endpoint detection.
 * Every `<end>` hands a finished turn to `onUtterance`. While `paused` (the
 * operator is thinking or talking) no audio is sent — so it never transcribes
 * its own voice — and a keepalive holds the socket and its context open.
 */
export function useVoiceConversation(onUtterance: (u: Utterance) => void, paused: boolean) {
  const [active, setActive] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<SonioxToken[]>([]);
  const lastHeardRef = useRef(0);
  const runIdRef = useRef(0);
  const pausedRef = useRef(paused);
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;

  // Coming back from a pause: the idle clock starts now, not at the last word.
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) lastHeardRef.current = Date.now();
  }, [paused]);

  const stop = useCallback(() => {
    runIdRef.current++;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send('');
        ws.close();
      } catch {}
    }
    pendingRef.current = [];
    setPartial('');
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    const runId = ++runIdRef.current;
    const cancelled = () => runIdRef.current !== runId;
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable here');
      const res = await fetch(`${getApiBase()}/api/dictation/token`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (cancelled()) return;
      if (!res.ok) throw new Error(body.error || 'Voice unavailable');

      // Echo cancellation matters here: the speakers play the operator's reply.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (cancelled()) return stream.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;

      const ws = new WebSocket(SONIOX_WS);
      wsRef.current = ws;
      // Hint the browser's languages plus English; Soniox still auto-detects.
      const hints = [...new Set([...navigator.languages.map((l) => l.slice(0, 2).toLowerCase()), 'en'])];

      ws.onopen = () => {
        if (cancelled()) return ws.close();
        ws.send(JSON.stringify({
          api_key: body.apiKey,
          model: MODEL,
          audio_format: 'pcm_s16le',
          sample_rate: ctx.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true,
          enable_language_identification: true,
          language_hints: hints,
        }));
        const source = ctx.createMediaStreamSource(stream);
        // ponytail: ScriptProcessorNode, same as useDictation — AudioWorklet if it ever costs.
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN && !pausedRef.current) ws.send(floatToPcm16(e.inputBuffer.getChannelData(0)));
        };
        source.connect(node);
        node.connect(ctx.destination);

        lastHeardRef.current = Date.now();
        timerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (pausedRef.current) ws.send(JSON.stringify({ type: 'keepalive' }));
          else if (Date.now() - lastHeardRef.current > IDLE_STOP_MS) stop();
        }, KEEPALIVE_MS);
        setActive(true);
      };

      ws.onmessage = (ev) => {
        let frame: SonioxFrame;
        try { frame = JSON.parse(ev.data); } catch { return; }
        if (frame.error_message) {
          setError(frame.error_message);
          return stop();
        }
        if (frame.tokens?.length) lastHeardRef.current = Date.now();
        const { pending, utterances, partial: live } = foldUtterances(pendingRef.current, frame);
        pendingRef.current = pending;
        setPartial((pending.map((t) => t.text).join('') + live).trim());
        for (const u of utterances) onUtteranceRef.current(u);
        if (frame.finished) stop();
      };
      ws.onerror = () => {
        setError('Voice connection failed');
        stop();
      };
      ws.onclose = () => {
        if (wsRef.current === ws) stop();
      };
    } catch (e) {
      if (!cancelled()) setError(e instanceof Error ? e.message : 'Voice failed');
      stop();
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { active, partial, error, start, stop };
}
