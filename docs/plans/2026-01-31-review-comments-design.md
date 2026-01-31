# Git Diff Review Comments System

## Overview

Add inline code review annotations to the GitDiffView component. Users can add comments to specific lines, batch them together, and send to Claude Code for automated fixes. Comments persist in the database with batch tracking for re-running later.

## Data Model

### Table: `review_comments`

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `session_id` | uuid | FK to session |
| `batch_id` | uuid | Groups comments sent together (null until proceed) |
| `file_path` | string | File being reviewed |
| `line_number` | int | Line in the file |
| `line_side` | enum | `"additions"` or `"deletions"` |
| `line_content` | text | Actual code at that line |
| `file_sha` | string | Git blob SHA at comment creation |
| `comment` | text | User's review comment |
| `status` | enum | `"pending"` / `"running"` / `"resolved"` |
| `created_at` | timestamp | When comment was added |
| `resolved_at` | timestamp | When batch completed |

### Status Lifecycle

```
pending → running → resolved
```

- Comments start as `pending`
- On "Proceed": assigned `batch_id`, status becomes `running`
- On Claude completion: auto-resolve entire batch
- Re-run creates new `pending` copies with new potential `batch_id`

## API Endpoints

Base path: `/sessions/:sessionId/review-comments`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List comments (filters: `?status=pending&batch_id=xxx`) |
| `POST` | `/` | Create comment |
| `DELETE` | `/:id` | Delete pending comment |
| `PATCH` | `/:id` | Update comment text |
| `POST` | `/proceed` | Start batch, returns formatted Claude message |
| `POST` | `/batches/:batchId/resolve` | Mark batch as resolved |
| `POST` | `/batches/:batchId/rerun` | Clone batch as new pending comments |
| `GET` | `/batches` | List all batches with summary |

### POST /review-comments (Create)

Request:
```json
{
  "filePath": "src/components/Auth.tsx",
  "lineNumber": 42,
  "lineSide": "additions",
  "lineContent": "const user = await getUser();",
  "fileSha": "abc123...",
  "comment": "Add null check before accessing user properties"
}
```

### POST /review-comments/proceed (Start Batch)

Response:
```json
{
  "batchId": "uuid",
  "message": "Please make the following code review changes:\n\n...",
  "commentCount": 5
}
```

## Frontend Components

### 1. ReviewCommentInput

Popover shown when clicking line number or "+" hover button.

- Text input for comment
- "Add Comment" button
- Shows existing pending comments on that line

### 2. ReviewCommentAnnotation

Inline annotation rendered via `@pierre/diffs` `renderAnnotation` prop.

- Comment bubble below the line
- Status indicator: pending (blue), running (yellow), resolved (green)
- "File changed" badge if current SHA differs from `file_sha`

### 3. ReviewBatchPanel

Slide-out panel for batch history.

- List of past batches: timestamp, comment count, status
- Expandable to see individual comments
- "Re-run" button per batch

### 4. GitDiffView Modifications

- Add "+" hover button via `renderHoverUtility`
- Enable `enableLineSelection` + `onLineNumberClick`
- "Proceed (N)" button in header with pending count badge
- "History" button to open ReviewBatchPanel

## User Flow

### Adding a Comment

1. User hovers line → "+" icon appears in gutter
2. Click "+" or line number → Popover opens
3. Type comment → Click "Add Comment"
4. Comment saved to backend (status: pending)
5. Blue annotation bubble appears below line

### Sending to Claude

1. User clicks "Proceed (3)" button in header
2. `POST /proceed` creates batch, returns formatted message
3. All pending comments → status: running (yellow indicators)
4. Message auto-inserted into Claude terminal input
5. User reviews and hits enter to send

### On Claude Completion

1. Detect Claude finished (terminal idle / output complete)
2. `POST /batches/:id/resolve`
3. All comments → status: resolved (green indicators)
4. Diff refreshes, shows "file changed" where SHA differs

### Re-running a Batch

1. User opens History panel
2. Finds batch, clicks "Re-run"
3. `POST /batches/:id/rerun` clones as new pending
4. User can edit/delete before proceeding again

## Claude Message Format

```markdown
Please make the following code review changes:

## src/components/Auth.tsx

**Line 42 (addition):**
```tsx
const user = await getUser();
```
> Add null check before accessing user properties

**Line 58 (addition):**
```tsx
return <div>{user.name}</div>
```
> Handle loading state

## src/lib/api.ts

**Line 15 (deletion):**
```ts
// TODO: fix this
```
> Remove this TODO comment, it's resolved

---
Batch ID: a1b2c3d4
```

## Technical Notes

### @pierre/diffs Integration

The library provides:
- `enableLineSelection` + `onLineNumberClick` for click handling
- `renderHoverUtility(getHoveredLine)` for the "+" gutter button
- `lineAnnotations: DiffLineAnnotation[]` with `{ lineNumber, side, metadata }`
- `renderAnnotation(annotation)` for custom annotation UI

### File SHA Tracking

- On comment creation, store current git blob SHA for the file
- Compare against current SHA to show "file changed" indicator
- Helps identify if comment may be stale or already addressed

### Batch ID Generation

- UUID generated on "Proceed" click
- All pending comments assigned same batch_id
- Enables grouping for resolve/rerun operations
