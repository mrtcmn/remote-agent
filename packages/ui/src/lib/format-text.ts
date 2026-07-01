// Minimal inline tokenizer for notification text. Recognizes fenced code blocks
// (```lang\n…\n```) and inline code (`…`) — everything else stays plain text.
// Deliberately tiny: notification bodies are short recaps, so we avoid pulling in
// a full markdown renderer.

export type FormattedToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string } // inline `code`
  | { type: 'bold'; value: string } // **bold**
  | { type: 'codeblock'; value: string; lang?: string }; // ```lang\n…\n```

// ```lang  +  optional trailing spaces/newline  +  body  +  closing ```
const FENCE_RE = /```([a-zA-Z0-9_+-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
// `code` (group 1) or **bold** (group 2) — neither spans a newline. Code is
// matched first so backticks win over asterisks inside them.
const INLINE_RE = /(`[^`\n]+`)|(\*\*(?:(?!\*\*).)+\*\*)/g;

function tokenizeInline(input: string): FormattedToken[] {
  const tokens: FormattedToken[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(input)) !== null) {
    if (match.index > last) tokens.push({ type: 'text', value: input.slice(last, match.index) });
    if (match[1] !== undefined) {
      tokens.push({ type: 'code', value: match[1].slice(1, -1) });
    } else {
      tokens.push({ type: 'bold', value: match[2].slice(2, -2) });
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < input.length) tokens.push({ type: 'text', value: input.slice(last) });
  return tokens;
}

export function tokenizeFormattedText(input: string): FormattedToken[] {
  if (!input) return [];
  const tokens: FormattedToken[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(input)) !== null) {
    if (match.index > last) tokens.push(...tokenizeInline(input.slice(last, match.index)));
    tokens.push({
      type: 'codeblock',
      lang: match[1] || undefined,
      value: match[2].replace(/\n$/, ''), // drop the newline immediately before the closing fence
    });
    last = FENCE_RE.lastIndex;
  }
  if (last < input.length) tokens.push(...tokenizeInline(input.slice(last)));
  return tokens;
}
