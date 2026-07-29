import { describe, expect, it } from 'bun:test';
import { applyFrame, floatToPcm16 } from './soniox';

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
