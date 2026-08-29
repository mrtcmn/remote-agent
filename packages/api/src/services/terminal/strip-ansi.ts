/**
 * Turn raw pty output into plain text: drop the escape sequences a terminal
 * emulator would have consumed, and collapse carriage-return redraws (progress
 * bars, spinners) to the last thing written on the line.
 *
 * ponytail: regex, not a vt100 parser. A full-screen TUI redrawing with cursor
 * moves still reads out of order — swap in a headless xterm if that matters.
 */
export function stripAnsi(text: string): string {
  return text
    // CSI (colours, cursor moves) and OSC (window titles) — OSC runs to BEL or ST.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[[\]][0-?]*[ -/]*[@-~]/g, '')
    // Remaining two-char escapes (charset selection, save/restore cursor, ...).
    .replace(/\x1b[@-Z\\-_]/g, '')
    .split('\n')
    .map((line) => {
      // A pty ends lines with CRLF; that trailing \r is not a redraw.
      const l = line.endsWith('\r') ? line.slice(0, -1) : line;
      // A line rewritten in place: keep only what survived the last \r.
      return l.slice(l.lastIndexOf('\r') + 1);
    })
    .join('\n');
}
