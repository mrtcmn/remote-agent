// Soniox real-time wire format — the pure bits, kept out of the hook so they're
// testable without a mic or websocket.
// Protocol: https://soniox.com/docs/stt/rt/real-time-transcription

export interface SonioxToken {
  text: string;
  is_final?: boolean;
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
