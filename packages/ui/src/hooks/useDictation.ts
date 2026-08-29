import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBase } from '@/lib/api-config';
import { applyFrame, floatToPcm16, type SonioxFrame } from '@/lib/soniox';

const SONIOX_WS = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MODEL = 'stt-rt-v5';

/**
 * Push-to-talk dictation in the browser: mic → Soniox real-time WS → text.
 * The Soniox key never reaches the client — we fetch a short-lived temporary
 * key from our own API and connect directly.
 *
 * `onText` fires once with the finished transcript when recording stops.
 */
export function useDictation(onText?: (text: string) => void) {
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const finalRef = useRef('');
  // Bumped on every stop(); an in-flight start() bails if it no longer matches,
  // so a quick tap-and-release can't leave a mic/socket running behind it.
  const runIdRef = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const teardownAudio = useCallback(() => {
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    teardownAudio();
    wsRef.current = null;
    setActive(false);
  }, [teardownAudio]);

  const deliver = useCallback(() => {
    const text = finalRef.current.trim();
    if (text) onTextRef.current?.(text);
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    const runId = ++runIdRef.current;
    const cancelled = () => runIdRef.current !== runId;

    setError(null);
    setTranscript('');
    finalRef.current = '';

    try {
      // Undefined in a non-secure context, or in a webview whose host app has no
      // microphone usage description — say so instead of throwing a TypeError.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable here');

      const res = await fetch(`${getApiBase()}/api/dictation/token`);
      const body = await res.json().catch(() => ({}));
      if (cancelled()) return;
      if (!res.ok) throw new Error(body.error || 'Dictation unavailable');
      const apiKey: string = body.apiKey;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      // ponytail: ask for 16k but tell Soniox whatever rate we actually get —
      // avoids a resampling step regardless of what the browser hands back.
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;

      const ws = new WebSocket(SONIOX_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled()) {
          try { ws.close(); } catch {}
          return;
        }
        ws.send(
          JSON.stringify({
            api_key: apiKey,
            model: MODEL,
            audio_format: 'pcm_s16le',
            sample_rate: ctx.sampleRate,
            num_channels: 1,
            // Push-to-talk: we stop on key release, not on silence, so a pause
            // mid-sentence doesn't cut you off.
            enable_endpoint_detection: false,
          })
        );

        const source = ctx.createMediaStreamSource(stream);
        // ponytail: ScriptProcessorNode is deprecated but one-file; swap for an
        // AudioWorklet only if the main-thread cost ever shows up.
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(floatToPcm16(e.inputBuffer.getChannelData(0)));
        };
        source.connect(node);
        node.connect(ctx.destination);
        setActive(true);
      };

      ws.onmessage = (ev) => {
        let frame: SonioxFrame;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (frame.error_message) {
          setError(frame.error_message);
          try { ws.close(); } catch {}
          cleanup();
          return;
        }
        const { finalText, partial } = applyFrame(finalRef.current, frame);
        finalRef.current = finalText;
        setTranscript((finalText + partial).trim());
        if (frame.finished) {
          deliver();
          try { ws.close(); } catch {}
          cleanup();
        }
      };

      ws.onerror = () => {
        setError('Dictation connection failed');
        cleanup();
      };
      ws.onclose = () => cleanup();
    } catch (e) {
      if (!cancelled()) setError(e instanceof Error ? e.message : 'Dictation failed');
      cleanup();
    }
  }, [cleanup, deliver]);

  const stop = useCallback(() => {
    runIdRef.current++; // cancel any in-flight start()
    const ws = wsRef.current;
    teardownAudio(); // release the mic immediately
    setActive(false);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(''); // "no more audio" — Soniox flushes finals, then finished:true
      // Don't wait forever if the server never closes the loop.
      setTimeout(() => {
        if (wsRef.current === ws) {
          deliver();
          try { ws.close(); } catch {}
          cleanup();
        }
      }, 3000);
    } else {
      if (ws) { try { ws.close(); } catch {} }
      cleanup();
    }
  }, [teardownAudio, deliver, cleanup]);

  // Drop the mic and socket if the component unmounts mid-recording.
  useEffect(() => () => { runIdRef.current++; cleanup(); }, [cleanup]);

  return { active, transcript, error, start, stop };
}
