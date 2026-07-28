// Pure parsing helpers for the Claude Code hook receivers (internal.routes.ts):
// turning a transcript JSONL + a PreToolUse payload into the live session detail
// the notch's vibe-island cards render. Kept db-free so they're unit-testable.
import { readFile } from 'node:fs/promises';

export interface AskUserQuestion {
  question: string;
  header?: string;
  options?: { label: string; description?: string; value?: string }[];
  multiSelect?: boolean;
}

export interface TranscriptInfo {
  stopReason?: string;
  summary?: string;   // Short (≤200 chars) — logging / fallback only
  fullText?: string;  // Full assistant text — classifier input + notification body
  // Extracted from AskUserQuestion tool calls
  askQuestion?: AskUserQuestion;      // First question — backward compat
  askQuestions?: AskUserQuestion[];   // ALL questions from the tool_use block
  // A background Workflow is still running (the main turn going idle is NOT a
  // completion — the workflow keeps churning and will notify on its own).
  workflowPending?: boolean;
  // Live session metrics for the notch's vibe-island cards (all best-effort —
  // absent when the last 20 transcript lines don't carry the signal).
  model?: string;        // short family name: opus | sonnet | haiku | fable
  todosDone?: number;    // completed items in the latest TodoWrite
  todosTotal?: number;   // total items in the latest TodoWrite
  contextPct?: number;   // ≈ last prompt tokens / 200k, 0–100 (see note below)
}

// "claude-opus-4-8[1m]" → "opus". Falls back to the raw id when nothing matches.
export function shortModelName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const m = id.match(/opus|sonnet|haiku|fable/i);
  return m ? m[0].toLowerCase() : id;
}

// A one-line "what's it doing right now" from a PreToolUse payload. tool_input
// arrives as an object (the /active hook keeps it structured, unlike /artifact).
export function describeTool(name: string | undefined, rawInput: unknown): string | undefined {
  if (!name) return undefined;
  const input: Record<string, unknown> =
    typeof rawInput === 'string'
      ? (() => { try { return JSON.parse(rawInput); } catch { return {}; } })()
      : (rawInput as Record<string, unknown>) ?? {};
  const base = (p: unknown) => (typeof p === 'string' ? p.split('/').pop() : undefined);
  const firstWord = (c: unknown) => (typeof c === 'string' ? c.trim().split(/\s+/)[0] : undefined);
  switch (name) {
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return `Editing ${base(input.file_path ?? input.notebook_path) ?? 'files'}`;
    case 'Read':   return `Reading ${base(input.file_path) ?? 'a file'}`;
    case 'Bash':   return `Running ${firstWord(input.command) ?? 'a command'}`;
    case 'Grep': case 'Glob':
      return `Searching ${typeof input.pattern === 'string' ? input.pattern : 'files'}`;
    case 'Task':   return typeof input.description === 'string' ? input.description : 'Delegating';
    case 'WebFetch': case 'WebSearch': return 'Searching the web';
    case 'TodoWrite': return 'Planning';
    default: return name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name;
  }
}

// Parse a transcript JSONL (last 20 entries) into a summary + structured tool
// calls + live metrics. Best-effort throughout — a malformed/short transcript
// just yields fewer fields.
export async function getTranscriptSummary(transcriptPath: string): Promise<TranscriptInfo> {
  try {
    const expandedPath = transcriptPath.replace(/^~/, process.env.HOME || '');
    const content = await readFile(expandedPath, 'utf-8');
    return parseTranscript(content);
  } catch (error) {
    console.error('Failed to parse transcript:', error);
    return {};
  }
}

// Split out from getTranscriptSummary so the parsing logic is testable without
// touching the filesystem.
export function parseTranscript(content: string): TranscriptInfo {
  const lines = content.trim().split('\n').filter(Boolean);

  // Parse JSONL - scan last 20 entries
  const entries = lines.slice(-20).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  let stopReason: string | undefined;
  let summary: string | undefined;
  let fullText: string | undefined;
  let askQuestion: AskUserQuestion | undefined;
  let askQuestions: AskUserQuestion[] | undefined;
  let workflowPending: boolean | undefined;
  let model: string | undefined;
  let todosDone: number | undefined;
  let todosTotal: number | undefined;
  let contextPct: number | undefined;

  for (const entry of [...entries].reverse()) {
    if (entry.stop_reason && !stopReason) {
      stopReason = entry.stop_reason;
    }

    // Model + context% come off the newest assistant turn's message. ponytail:
    // context% ≈ that turn's prompt size / 200k — approximate (assumes a 200k
    // window, ignores model-specific limits), but good enough for a glanceable
    // gauge. Newest wins (loop is newest-first).
    if (entry.type === 'assistant' && entry.message) {
      if (!model) model = shortModelName(entry.message.model);
      const u = entry.message.usage;
      if (contextPct === undefined && u) {
        const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (prompt > 0) contextPct = Math.min(100, Math.round((prompt / 200_000) * 100));
      }
    }

    // Claude Code stamps the live background-workflow count on each turn_duration
    // system entry. Newest wins (loop is newest-first). >0 → a workflow is running.
    if (workflowPending === undefined && typeof entry.pendingWorkflowCount === 'number') {
      workflowPending = entry.pendingWorkflowCount > 0;
    }

    if (entry.type === 'assistant' && entry.message?.content && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        // Latest TodoWrite → progress chip (done/total). Newest wins.
        if (todosTotal === undefined && block.type === 'tool_use' && block.name === 'TodoWrite') {
          const todos = block.input?.todos;
          if (Array.isArray(todos) && todos.length > 0) {
            todosTotal = todos.length;
            todosDone = todos.filter((t: { status?: string }) => t.status === 'completed').length;
          }
        }

        // Extract AskUserQuestion tool calls — these have structured options
        if (!askQuestion && block.type === 'tool_use' && block.name === 'AskUserQuestion') {
          const questions: AskUserQuestion[] = block.input?.questions ?? [];
          if (questions.length > 0) {
            askQuestion = questions[0];   // First — backward compat
            askQuestions = questions;     // ALL questions carried through
          }
        }

        // Extract last text summary from assistant
        if (!summary && block.type === 'text' && block.text) {
          const text = block.text;
          summary = text.length > 200 ? text.slice(0, 200) + '...' : text;
          fullText = text; // full text for notification body
        }
      }
    }

    if (stopReason && summary && askQuestion) break;
  }

  return { stopReason, summary, fullText, askQuestion, askQuestions, workflowPending, model, todosDone, todosTotal, contextPct };
}
