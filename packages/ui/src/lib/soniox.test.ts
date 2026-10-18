import { describe, expect, it } from 'bun:test';
import { applyFrame, floatToPcm16, foldUtterances, pcm16ToFloat } from './soniox';

describe('floatToPcm16', () => {
  it('maps the [-1,1] range to full int16', () => {
    const pcm = new Int16Array(floatToPcm16(new Float32Array([0, 1, -1, 0.5])));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(16383);
  });

  it('clamps out-of-range samples', () => {
    const pcm = new Int16Array(floatToPcm16(new Float32Array([2, -2])));
    expect(pcm[0]).toBe(32767);
    expect(pcm[1]).toBe(-32768);
  });
});

describe('applyFrame', () => {
  it('appends finals and replaces the partial tail', () => {
    let final = '';
    ({ finalText: final } = applyFrame(final, { tokens: [{ text: 'Hello ', is_final: true }, { text: 'wor', is_final: false }] }));
    expect(final).toBe('Hello ');

    const step = applyFrame(final, { tokens: [{ text: 'world', is_final: true }] });
    expect(step.finalText).toBe('Hello world');
    expect(step.partial).toBe('');
  });

  it('ignores <end>/<fin> control tokens', () => {
    const { finalText, partial } = applyFrame('hi', {
      tokens: [{ text: '<end>' }, { text: '<fin>' }, { text: ' there', is_final: true }],
    });
    expect(finalText).toBe('hi there');
    expect(partial).toBe('');
  });
});

describe('foldUtterances', () => {
  it('cuts a turn at <end> with the majority language, keeping later finals pending', () => {
    const a = foldUtterances([], { tokens: [{ text: 'Ne ', is_final: true, language: 'tr' }, { text: 'oldu', is_final: false, language: 'tr' }] });
    expect(a.utterances).toEqual([]);
    expect(a.partial).toBe('oldu');

    const b = foldUtterances(a.pending, {
      tokens: [
        { text: 'oldu session', is_final: true, language: 'tr' },
        { text: '?', is_final: true, language: 'en' },
        { text: '<end>', is_final: true },
        { text: 'Next', is_final: true, language: 'en' },
      ],
    });
    expect(b.utterances).toEqual([{ text: 'Ne oldu session?', language: 'tr' }]);
    expect(b.pending.map((t) => t.text)).toEqual(['Next']);
  });

  it('drops an empty turn', () => {
    expect(foldUtterances([], { tokens: [{ text: '<end>', is_final: true }] }).utterances).toEqual([]);
  });
});

describe('pcm16ToFloat', () => {
  it('decodes samples and carries a sample split across chunks', () => {
    const bytes = new Uint8Array(floatToPcm16(new Float32Array([0.5, -1, 0.25])));
    const a = pcm16ToFloat(null, bytes.slice(0, 3)); // 1.5 samples
    expect(a.samples.length).toBe(1);
    expect(a.samples[0]).toBeCloseTo(0.5, 3);
    expect(a.carry?.length).toBe(1);

    const b = pcm16ToFloat(a.carry, bytes.slice(3));
    expect([...b.samples].map((x) => Number(x.toFixed(3)))).toEqual([-1, 0.25]);
    expect(b.carry).toBeNull();
  });
});
