import { describe, expect, it } from 'bun:test';
import {
  buildExecutePrompt, buildPlanPrompt, buildTaskBriefing, extractSteps,
  extractText, parseChecklist, statusForRun, unwrapMarkdown,
} from './agent-plan.service';
import { pickActiveProject } from './kanban.service';

describe('extractText', () => {
  it('unwraps the claude --output-format json envelope', () => {
    const raw = JSON.stringify({ type: 'result', result: '# Plan\n\nbody', cost_usd: 0.02 });
    expect(extractText(raw)).toBe('# Plan\n\nbody');
  });

  it('falls back to the raw text when the output is not JSON', () => {
    expect(extractText('  plain output  ')).toBe('plain output');
  });

  it('falls back when the JSON carries no result field', () => {
    expect(extractText('{"error":"boom"}')).toBe('{"error":"boom"}');
  });
});

describe('unwrapMarkdown', () => {
  it('strips a whole-document markdown fence', () => {
    expect(unwrapMarkdown('```markdown\n# Plan\n\n## Overview\n```')).toBe('# Plan\n\n## Overview');
  });

  it('keeps an inner mermaid fence intact', () => {
    const doc = '# Plan\n\n```mermaid\ngraph TD\n  A-->B\n```';
    expect(unwrapMarkdown(doc)).toBe(doc);
  });
});

describe('prompts', () => {
  it('asks the planner for a mermaid diagram and the UI/API/DB split', () => {
    const prompt = buildPlanPrompt({ title: 'Add dark mode', description: 'toggle in settings' });
    expect(prompt).toContain('Add dark mode');
    expect(prompt).toContain('toggle in settings');
    expect(prompt).toContain('mermaid');
    expect(prompt).toContain('### DB');
  });

  it('offers diagram types beyond the architecture flowchart', () => {
    const prompt = buildPlanPrompt({ title: 'Add dark mode' });
    for (const type of ['sequenceDiagram', 'erDiagram', 'stateDiagram-v2', 'mindmap', 'gitGraph']) {
      expect(prompt).toContain(type);
    }
    // The flowchart is the one that is never optional.
    expect(prompt).toContain('architecture flowchart is always one');
  });

  /**
   * Every type named here was rendered against the app's mermaid build (see the
   * comment above DIAGRAM_MENU). `swimlane-beta` does not parse there, so the
   * planner must never be told to reach for it.
   */
  it('never offers a diagram type this build cannot render', () => {
    expect(buildPlanPrompt({ title: 'x' })).not.toContain('swimlane');
  });

  it('carries the rules that stop a diagram failing to parse', () => {
    const prompt = buildPlanPrompt({ title: 'x' });
    expect(prompt).toContain('`end` as a node id');
    expect(prompt).toContain('under 15 nodes');
    expect(prompt).toContain('Label every branch');
  });

  it('hands the executor the plan it wrote', () => {
    const prompt = buildExecutePrompt({ id: 't1', title: 'Add dark mode', planDoc: '## Steps\n1. do it' });
    expect(prompt).toContain('1. do it');
    expect(prompt).toContain('--- END PLAN ---');
  });
});

describe('statusForRun', () => {
  it('moves the column to In Progress while the agent runs', () => {
    expect(statusForRun('executing')).toBe('in_progress');
  });

  it('moves it to Review Needed when the run succeeds', () => {
    expect(statusForRun('done')).toBe('review_needed');
  });

  it('leaves a failed run where it is — it is still in progress', () => {
    expect(statusForRun('failed')).toBeNull();
  });
});

describe('pickActiveProject', () => {
  const p = (projectId: string, projectName: string, sessions = 1) => ({ projectId, projectName, sessions });

  it('resolves when exactly one project is running', () => {
    expect(pickActiveProject([p('p1', 'remote-agent', 2)])).toEqual({
      resolved: true, projectId: 'p1', projectName: 'remote-agent', sessions: 2,
    });
  });

  it('asks when nothing is running', () => {
    expect(pickActiveProject([])).toEqual({ resolved: false, reason: 'none', candidates: [] });
  });

  it('asks — and never picks — when several are running', () => {
    const running = [p('p1', 'alpha'), p('p2', 'beta')];
    const got = pickActiveProject(running);
    expect(got.resolved).toBe(false);
    expect(got).toMatchObject({ reason: 'ambiguous' });
    // The candidates must survive so the caller can name them in the question.
    expect((got as { candidates: unknown[] }).candidates).toEqual(running);
  });
});

describe('extractSteps', () => {
  it('pulls the numbered steps out of a plan', () => {
    const doc = '## Architecture\ntext\n\n## Steps\n1. Add the column\n2. Wire the route\n\n## Risks\n- none';
    expect(extractSteps(doc)).toEqual(['Add the column', 'Wire the route']);
  });

  it('ignores numbers inside a fenced block', () => {
    const doc = '## Steps\n1. Real step\n\n```\n2. not a step\n```\n';
    expect(extractSteps(doc)).toEqual(['Real step']);
  });

  it('returns nothing when the plan has no Steps heading', () => {
    expect(extractSteps('## Overview\n1. not steps')).toEqual([]);
  });
});

describe('parseChecklist', () => {
  it('reads a stored checklist', () => {
    expect(parseChecklist('[{"text":"a","done":true}]')).toEqual([{ text: 'a', done: true }]);
  });

  it('treats missing or broken JSON as empty', () => {
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist('not json')).toEqual([]);
  });
});

describe('buildTaskBriefing', () => {
  const task = { id: 'abc123', title: 'Ship it', projectName: 'remote-agent' };

  it('tells the agent it is a Remote Agent task and names the board tools', () => {
    const b = buildTaskBriefing(task);
    expect(b).toContain('This is a Remote Agent task');
    expect(b).toContain('abc123');
    expect(b).toContain('remote-agent');
    expect(b).toContain('comment_task');
    expect(b).toContain('update_task');
    expect(b).toContain('Report progress as you work');
  });

  it('lists the checklist with the indexes check_item expects', () => {
    const b = buildTaskBriefing({ ...task, checklist: '[{"text":"First","done":true},{"text":"Second","done":false}]' });
    expect(b).toContain('0. [x] First');
    expect(b).toContain('1. [ ] Second');
    expect(b).toContain('check_item');
  });

  it('asks for a checklist when the task has none', () => {
    const b = buildTaskBriefing(task);
    expect(b).toContain('set_checklist');
    expect(b).toContain('no checklist');
  });
});
