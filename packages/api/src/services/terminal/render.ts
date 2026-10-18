import { Terminal } from '@xterm/headless';

/**
 * Raw pty bytes → the text a person would actually see, by replaying them into
 * a headless xterm (the same parser the UI renders with). Unlike stripAnsi this
 * survives full-screen TUIs like Claude Code, which redraw with cursor moves.
 *
 * Replays the whole buffer per call (~1MB cap upstream): fine for an on-demand
 * read, not for a hot loop.
 */
export function renderTerminal(raw: Uint8Array, cols = 120, rows = 40, scrollback = 5000): Promise<string> {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  return new Promise((resolve) => {
    term.write(raw, () => {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        // A soft-wrapped row continues the previous one rather than starting a line.
        const text = line.translateToString(true);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
        else lines.push(text);
      }
      term.dispose();
      // Trailing blank rows are just the unused part of the screen.
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      // The empty middle of a TUI screen reads as one gap, not a dozen blank lines.
      resolve(lines.join('\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n'));
    });
  });
}
