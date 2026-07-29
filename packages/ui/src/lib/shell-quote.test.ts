import { describe, expect, it } from 'bun:test';
import { shellQuote } from './shell-quote';

describe('shellQuote', () => {
  it('leaves plain paths alone', () => {
    expect(shellQuote('/Users/me/project/src/index.ts')).toBe('/Users/me/project/src/index.ts');
  });

  it('quotes paths needing it', () => {
    expect(shellQuote('/Users/me/Desktop/Screen Shot (1).png')).toBe(
      "'/Users/me/Desktop/Screen Shot (1).png'"
    );
    expect(shellQuote("/tmp/it's here.txt")).toBe(`'/tmp/it'\\''s here.txt'`);
  });
});
