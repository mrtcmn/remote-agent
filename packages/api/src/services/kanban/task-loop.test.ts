import { describe, expect, test } from 'bun:test';
import { buildReviewPrompt, columnForSignal, gate, parseVerdict } from './task-loop.service';

describe('columnForSignal', () => {
  test('working pulls a waiting or reviewed task into progress', () => {
    expect(columnForSignal('working', 'backlog')).toBe('in_progress');
    expect(columnForSignal('working', 'todo')).toBe('in_progress');
    expect(columnForSignal('working', 'review_needed')).toBe('in_progress');
  });

  test('working never undoes a move the agent made to manual testing', () => {
    expect(columnForSignal('working', 'manual_testing')).toBeNull();
    expect(columnForSignal('working', 'completed')).toBeNull();
  });

  test('done moves only a task still in progress', () => {
    expect(columnForSignal('done', 'in_progress')).toBe('review_needed');
    expect(columnForSignal('done', 'manual_testing')).toBeNull();
  });
});

describe('parseVerdict', () => {
  test('takes the JSON object out of the referee\'s reply', () => {
    const v = parseVerdict('I ran the bench.\n{"pass": true, "reason": "34% faster", "evidence": "1.2s vs 1.8s"}');
    expect(v).toEqual({ pass: true, reason: '34% faster', evidence: '1.2s vs 1.8s' });
  });

  test('takes the last object when the referee thinks out loud', () => {
    const v = parseVerdict('{"pass": false, "reason": "first"} then {"pass": true, "reason": "final"}');
    expect(v.pass).toBe(true);
    expect(v.reason).toBe('final');
  });

  test('a brace inside the evidence does not cut the object short', () => {
    const v = parseVerdict(String.raw`{"pass": true, "reason": "ok", "evidence": "awk '{print $1}' out.txt -> 1.2s"}`);
    expect(v.pass).toBe(true);
    expect(v.evidence).toContain('{print $1}');
  });

  test('reads a nested object', () => {
    const v = parseVerdict('{"pass": false, "reason": "slow", "extra": {"ms": 1800}}');
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('slow');
  });

  test('no verdict is a failure, not a pass', () => {
    const v = parseVerdict('I could not run the benchmark.');
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('could not run the benchmark');
  });
});

describe('gate', () => {
  const met = { pass: true, reason: 'The bench is 34% faster than main.', evidence: '1.2s vs 1.8s' };

  test('passes when the referee passes and every item is done', () => {
    expect(gate(met, [{ text: 'a', done: true }]).pass).toBe(true);
    expect(gate(met, []).pass).toBe(true);
  });

  test('a failed goal sends the referee reason and evidence back', () => {
    const r = gate({ pass: false, reason: 'Only 12% faster.', evidence: '1.6s vs 1.8s' }, []);
    expect(r.pass).toBe(false);
    expect(r.feedback).toContain('Only 12% faster.');
    expect(r.feedback).toContain('1.6s vs 1.8s');
    expect(r.record).toContain('Only 12% faster.');
  });

  test('open checklist items fail the gate even when the referee passes', () => {
    const r = gate(met, [{ text: 'done one', done: true }, { text: 'write docs', done: false }]);
    expect(r.pass).toBe(false);
    expect(r.feedback).toContain('1. write docs');
  });
});

test('buildReviewPrompt numbers each comment', () => {
  const p = buildReviewPrompt('Fix login', ['rename the flag', 'add a test'], 'Keep it small.');
  expect(p).toContain('"Fix login"');
  expect(p).toContain('1. rename the flag');
  expect(p).toContain('2. add a test');
  expect(p).toContain('Keep it small.');
});
