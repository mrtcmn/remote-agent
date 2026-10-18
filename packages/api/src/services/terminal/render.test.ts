import { expect, test } from 'bun:test';
import { renderTerminal } from './render';

const enc = (s: string) => new TextEncoder().encode(s);

test('a cursor-up redraw shows the final screen, not every frame', async () => {
  // Draw two lines, move up two rows, overwrite both — what a TUI spinner/status does.
  const raw = enc('Thinking...\r\nstep 1\r\n\x1b[2A\r\x1b[2KDone.\r\n\x1b[2Kall good\r\n');
  expect(await renderTerminal(raw, 40, 10)).toBe('Done.\nall good');
});

test('soft-wrapped rows join back into one line', async () => {
  expect(await renderTerminal(enc('abcdefghij'), 4, 5)).toBe('abcdefghij');
});

test('blank screen rows collapse to one gap', async () => {
  expect(await renderTerminal(enc('top\r\n\r\n\r\n\r\n\r\nbottom'), 20, 10)).toBe('top\n\nbottom');
});
