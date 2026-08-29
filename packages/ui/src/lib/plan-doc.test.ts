import { describe, expect, it } from 'bun:test';
import { parsePlanDoc } from './plan-doc';

describe('parsePlanDoc', () => {
  it('splits prose from a mermaid diagram', () => {
    const doc = '# Plan\n\n## Architecture\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n## Steps\n1. go';
    expect(parsePlanDoc(doc)).toEqual([
      { type: 'markdown', value: '# Plan\n\n## Architecture' },
      { type: 'mermaid', value: 'graph TD\n  A-->B' },
      { type: 'markdown', value: '## Steps\n1. go' },
    ]);
  });

  it('keeps a non-mermaid fence inside the prose', () => {
    const doc = 'before\n\n```ts\nconst a = 1;\n```\n\nafter';
    expect(parsePlanDoc(doc)).toEqual([{ type: 'markdown', value: doc }]);
  });

  it('handles several diagrams', () => {
    const doc = '```mermaid\ngraph TD\n  A-->B\n```\nmid\n```mermaid\ngraph LR\n  C-->D\n```';
    expect(parsePlanDoc(doc).map((b) => b.type)).toEqual(['mermaid', 'markdown', 'mermaid']);
  });

  it('returns nothing for an empty document', () => {
    expect(parsePlanDoc('   ')).toEqual([]);
  });
});
