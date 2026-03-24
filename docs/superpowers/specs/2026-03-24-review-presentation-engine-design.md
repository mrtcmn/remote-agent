# Review Presentation Engine — Design Spec

## Problem

When Claude (or a developer) makes changes across multiple files, understanding _what_ changed and _why_ requires parsing raw diffs. This is cognitive overhead — especially for non-trivial changes that span multiple files. There's no storytelling layer that turns a set of changes into a readable narrative.

## Solution

A **Review Presentation Engine** that takes code changes (unstaged, staged, or specific commit hashes) and generates an article-style slide presentation. Each slide represents one **logical change group** — potentially spanning multiple files — with an LLM-generated narrative and smart diff excerpts showing the most important hunks.

## Core Concepts

### Pure Function API

The engine is source-agnostic. A single function signature handles all inputs:

```typescript
interface PresentationRequest {
  projectPath: string;
  unstaged?: boolean;       // git diff
  staged?: boolean;         // git diff --cached
  commitHashes?: string[];  // git show <hash>
}
```

The same pipeline produces the same output structure regardless of source.

### Two-Phase LLM Pipeline

**Phase 1 — Planning:** One `completeJSON()` call receives all diffs and returns a structured grouping plan:

```typescript
interface SlidePlan {
  slides: Array<{
    title: string;           // e.g. "Add input validation to search endpoint"
    files: string[];         // files in this logical group
    importance: 'high' | 'medium' | 'low';
    hunkSelectors: Array<{   // which hunks to excerpt
      filePath: string;
      hunkIndices: number[]; // indices into parsed hunks
    }>;
  }>;
  summary: string;           // one-line overview of all changes
}
```

**Phase 2 — Narration:** For each slide in the plan, one `complete()` call with just that slide's diff excerpts generates the narrative. Slides stream to the frontend via SSE as each completes.

```typescript
interface PresentationSlide {
  id: string;
  index: number;
  title: string;
  narrative: string;         // LLM-generated explanation
  importance: 'high' | 'medium' | 'low';
  files: string[];
  excerpts: DiffExcerpt[];
  fullDiff: string;          // raw diff for "show full" toggle
  annotations: SlideAnnotation[];
}

interface DiffExcerpt {
  filePath: string;
  patch: string;             // unified diff hunk(s) — renderable by @pierre/diffs
  explanation: string;       // why this hunk matters
}

interface SlideAnnotation {
  id: string;
  slideId: string;
  text: string;
  createdAt: string;
}
```

### Streaming via SSE

No changes to `LLMEngine` interface. Streaming happens at the HTTP transport layer:

1. Frontend opens SSE connection to `GET /api/sessions/:id/presentation/stream`
2. Backend sends `event: plan` with the slide outline (skeleton slides render immediately)
3. For each slide, backend calls `llmEngine.complete()` and sends `event: slide` with the full slide data
4. `event: done` signals completion
5. `event: error` for failures

## Architecture

### Backend

#### New Files

```
packages/api/src/services/presentation/
├── types.ts                    # All type definitions
├── presentation.service.ts     # Core service — diff collection, LLM calls, slide assembly
├── prompts.ts                  # System prompts for planning and narration
└── index.ts                    # Public exports

packages/api/src/routes/
└── presentation.routes.ts      # SSE endpoint + annotation CRUD
```

#### Git Service Extension

Add to existing `GitService` in `packages/api/src/services/git/git.service.ts`:

```typescript
async commitDiff(projectPath: string, hash: string): Promise<string> {
  const result = await $`git show ${hash} --format= --patch`.cwd(projectPath).nothrow().quiet();
  return result.stdout.toString();
}

async stagedDiff(projectPath: string): Promise<string> {
  const result = await $`git diff --cached`.cwd(projectPath).nothrow().quiet();
  return result.stdout.toString();
}

async unstagedDiff(projectPath: string): Promise<string> {
  const result = await $`git diff`.cwd(projectPath).nothrow().quiet();
  return result.stdout.toString();
}
```

Note: `diff()` with `cached=true` already exists but `commitDiff()` for arbitrary hashes does not. `stagedDiff` and `unstagedDiff` are explicit variants for the presentation engine to call independently.

#### Presentation Service

```typescript
// packages/api/src/services/presentation/presentation.service.ts

export class PresentationService {
  // Pure function: collect diffs based on request type
  async collectDiffs(request: PresentationRequest): Promise<string> { ... }

  // Phase 1: LLM groups changes into logical slides
  async generatePlan(fullDiff: string): Promise<SlidePlan> { ... }

  // Phase 2: LLM writes narrative for one slide
  async generateSlideNarrative(slide: SlidePlanEntry, excerptDiffs: string): Promise<string> { ... }

  // Orchestrator: yields slides as they complete (for SSE)
  async *generatePresentation(request: PresentationRequest): AsyncGenerator<SSEEvent> { ... }
}
```

The `generatePresentation` method is an async generator that:
1. Collects diffs via `collectDiffs()`
2. Calls `generatePlan()` → yields `{ event: 'plan', data: slidePlan }`
3. For each slide, extracts relevant hunks, calls `generateSlideNarrative()` → yields `{ event: 'slide', data: slide }`
4. Yields `{ event: 'done' }`

#### SSE Route

```typescript
// packages/api/src/routes/presentation.routes.ts

// Stream presentation
GET /sessions/:id/presentation/stream
  Query: { unstaged?: boolean, staged?: boolean, commitHashes?: string (comma-separated) }
  Response: text/event-stream

// Annotation CRUD (in-memory or DB — TBD based on persistence needs)
POST   /sessions/:id/presentation/annotations     { slideId, text }
DELETE /sessions/:id/presentation/annotations/:annotationId
```

Route registration: add `presentationRoutes` to `packages/api/src/routes/index.ts`.

#### LLM Prompts

**Planning prompt** — sends file names + diff stats + first N lines per hunk to stay within context. Asks for logical groupings, importance ranking, and hunk selection.

**Narration prompt** — sends the selected hunks for one slide. Asks for a concise explanation of what changed and why, written for a developer audience. Should be 2-4 sentences per slide.

### Frontend

#### New Files

```
packages/ui/src/components/presentation/
├── PresentationModal.tsx       # Full-screen modal overlay with scroll navigation
├── SlideCard.tsx               # Single slide: narrative + diff excerpts
├── SlideAnnotation.tsx         # Optional annotation input/display per slide
└── SlideSkeleton.tsx           # Loading skeleton shown during Phase 1

packages/ui/src/hooks/
└── usePresentationStream.ts    # SSE connection management + state
```

#### usePresentationStream Hook

```typescript
interface UsePresentationStreamReturn {
  plan: SlidePlan | null;
  slides: PresentationSlide[];
  status: 'idle' | 'connecting' | 'planning' | 'narrating' | 'done' | 'error';
  error: string | null;
  start: (request: PresentationRequest) => void;
  cancel: () => void;
}
```

Uses `EventSource` or `fetch()` with `ReadableStream` reader to consume SSE events. Manages progressive state as slides arrive.

#### PresentationModal

- Full-screen modal overlay (matches existing modal patterns in codebase)
- Vertical scroll with distinct slide sections
- Each slide is a `SlideCard` component
- During planning phase: shows `SlideSkeleton` placeholders based on the plan outline
- Slides fill in progressively as narration completes
- Close button returns to session view

#### SlideCard

- **Header**: slide title + importance badge + file list
- **Narrative**: LLM-generated text, rendered as markdown
- **Diff excerpts**: each rendered with `PatchDiff` from `@pierre/diffs/react` (reusing `WorkerPoolContextProvider` and theme config from existing `GitDiffView.tsx`)
- **"Show full diff" toggle**: expands to show the complete diff for all files in the group
- **Annotation**: optional text input that appears on click, similar to existing `ReviewCommentInput` pattern

#### Trigger

Add a "Review" button to the Git panel toolbar (near existing stage/commit/push buttons). Opens the `PresentationModal` with auto-detected source:
- If there are unstaged/staged changes → uses those
- If clean working tree → uses last commit hash

## Reused Existing Code

| What | From | How |
|------|------|-----|
| Diff rendering | `@pierre/diffs` (`PatchDiff`, `parsePatchFiles`, `WorkerPoolContextProvider`) | Render smart excerpts in SlideCard |
| LLM calls | `llmEngine.completeJSON()` / `complete()` | Planning + narration phases |
| LLM prompt pattern | `NotificationClassifier` | Same `{ prompt, systemPrompt }` pattern with JSON schema |
| Git operations | `GitService` (extended) | Collect diffs from various sources |
| Auth middleware | `requireAuth` from Elysia | Protect SSE endpoint |
| Route patterns | `review-comments.routes.ts` | Elysia route structure, session ownership checks |
| Annotation UX | `ReviewCommentInput.tsx` | Pattern for optional text annotations |
| Theme config | `constants.ts` DIFF_THEME | Pierre dark/light theme for diff rendering |
| Error boundaries | `DiffErrorBoundary` in GitDiffView | Wrap diff rendering in SlideCard |

## Data Flow

```
User clicks "Review" button
  → Frontend opens SSE: GET /api/sessions/:id/presentation/stream?unstaged=true
  → Backend: PresentationService.collectDiffs() → raw diff string
  → Backend: PresentationService.generatePlan() → llmEngine.completeJSON<SlidePlan>()
  → SSE event: plan → Frontend renders skeleton slides
  → For each slide:
      → Backend: extract hunks, generateSlideNarrative() → llmEngine.complete()
      → SSE event: slide → Frontend renders SlideCard with narrative + diff
  → SSE event: done → Frontend shows completion state
```

## Error Handling

- LLM failure during planning: return error event, frontend shows "Could not analyze changes"
- LLM failure during narration for one slide: skip that slide's narrative, show diff excerpts only with "Narrative unavailable" note
- Empty diff: return immediately with "No changes to present"
- SSE connection drop: frontend shows reconnect option

## Testing

1. **Service unit tests**: mock `llmEngine` and `gitService`, verify `collectDiffs()` handles all input combinations, verify `generatePresentation()` yields events in correct order
2. **Route integration test**: verify SSE endpoint returns correct content-type and event format
3. **Manual UI test**: trigger presentation from Git panel, verify slides render progressively with diff excerpts
