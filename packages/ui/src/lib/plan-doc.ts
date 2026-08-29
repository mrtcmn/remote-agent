export type PlanBlock =
  | { type: 'markdown'; value: string }
  | { type: 'mermaid'; value: string };

const MERMAID_FENCE = /^```mermaid[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;

/**
 * Splits an agent plan document into prose and mermaid diagrams, so the prose
 * goes to the normal text renderer and each diagram gets its own canvas.
 */
export function parsePlanDoc(doc: string): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  let cursor = 0;

  MERMAID_FENCE.lastIndex = 0;
  for (const match of doc.matchAll(MERMAID_FENCE)) {
    const start = match.index ?? 0;
    const prose = doc.slice(cursor, start).trim();
    if (prose) blocks.push({ type: 'markdown', value: prose });

    const diagram = match[1].trim();
    if (diagram) blocks.push({ type: 'mermaid', value: diagram });

    cursor = start + match[0].length;
  }

  const tail = doc.slice(cursor).trim();
  if (tail) blocks.push({ type: 'markdown', value: tail });

  return blocks;
}
