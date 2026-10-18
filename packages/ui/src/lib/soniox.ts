// Soniox real-time wire format — the pure bits, kept out of the hook so they're
// testable without a mic or websocket.
// Protocol: https://soniox.com/docs/stt/rt/real-time-transcription

export interface SonioxToken {
  text: string;
  is_final?: boolean;
  /** Set when enable_language_identification is on. */
  language?: string;
}

export interface SonioxFrame {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_message?: string;
}

/** Mic Float32 [-1,1] → 16-bit little-endian PCM, the raw frames Soniox wants. */
export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/**
 * Fold a frame into the running transcript. Final tokens append to `finalText`;
 * non-final tokens are re-sent in full each frame, so they replace the tail.
 * `<end>`/`<fin>` are control tokens, not words.
 */
export function applyFrame(
  finalText: string,
  frame: SonioxFrame
): { finalText: string; partial: string } {
  let next = finalText;
  let partial = '';
  for (const tok of frame.tokens ?? []) {
    if (tok.text === '<end>' || tok.text === '<fin>') continue;
    if (tok.is_final) next += tok.text;
    else partial += tok.text;
  }
  return { finalText: next, partial };
}

export interface Utterance {
  text: string;
  /** Majority language of its tokens; undefined without language identification. */
  language?: string;
}

/**
 * Conversation mode: fold a frame into the pending final tokens and cut a turn
 * at every `<end>` (Soniox endpoint detection). Returns the finished utterances,
 * the still-pending finals, and the live partial for captions.
 */
export function foldUtterances(
  pending: SonioxToken[],
  frame: SonioxFrame
): { pending: SonioxToken[]; utterances: Utterance[]; partial: string } {
  let buf = pending;
  const utterances: Utterance[] = [];
  let partial = '';
  for (const tok of frame.tokens ?? []) {
    if (tok.text === '<end>') {
      const text = buf.map((t) => t.text).join('').trim();
      if (text) {
        const votes = new Map<string, number>();
        for (const t of buf) if (t.language) votes.set(t.language, (votes.get(t.language) ?? 0) + 1);
        const language = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
        utterances.push({ text, language });
      }
      buf = [];
    } else if (tok.text === '<fin>') {
      continue;
    } else if (tok.is_final) {
      buf = [...buf, tok];
    } else {
      partial += tok.text;
    }
  }
  return { pending: buf, utterances, partial };
}

/**
 * Streamed TTS: 16-bit little-endian PCM bytes → Float32 samples for Web Audio.
 * Network chunks can split a sample in half, so an odd trailing byte is carried
 * into the next call.
 */
export function pcm16ToFloat(carry: Uint8Array | null, chunk: Uint8Array): { samples: Float32Array<ArrayBuffer>; carry: Uint8Array | null } {
  let bytes = chunk;
  if (carry) {
    bytes = new Uint8Array(carry.length + chunk.length);
    bytes.set(carry);
    bytes.set(chunk, carry.length);
  }
  const even = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  const samples = new Float32Array(even / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return { samples, carry: even < bytes.length ? bytes.slice(even) : null };
}
