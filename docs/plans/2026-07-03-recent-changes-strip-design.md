# Recent Changes Strip — Design

Date: 2026-07-03

## Goal

A thin horizontal strip below the xterm terminal that lists git-changed files,
**most-recently-touched first**. Each file is a clickable chip; clicking opens
that file in the file manager (via a URL param, so it's shareable and survives
reload). Reuses the git status polling that already runs on the web UI.

## Decisions

- **Recency source:** file `mtime` (`fs.stat`), newest-first. Reflects real edits
  including untracked files and edits made outside git.
- **Resource guard:** mtime is computed **only when explicitly requested** by the
  strip (`?recent=1`), and the strip only mounts for the currently-open session in
  terminal view. Idle/background sessions and the git tab never pay the stat cost.
- **Placement:** terminal view only — a fixed-height strip below `<Terminal>`.
- **Open mechanism:** URL query param `?file=<encoded relative path>` (file paths
  contain slashes; a path segment would need a splat route + encoding).
- **Auto-expand:** opening a file expands the file tree down to it and scrolls it
  into view.

## Components

### 1. Backend — opt-in mtime on git status

`packages/api/src/services/git/git.service.ts` — `status()` (~line 367).

- Add an optional flag: `status(targetPath, { recent }: { recent?: boolean } = {})`.
- When `recent` is set, after building the `staged/modified/untracked` arrays,
  `fs.stat` each unique changed file and build a new field:

  ```ts
  recent: { path: string; status: 'staged' | 'modified' | 'untracked'; mtimeMs: number }[]
  ```

  sorted by `mtimeMs` descending. `fs.stat` failures (e.g. deleted files) → skip
  (or `mtimeMs: 0`). Wrap the stats in `Promise.all` over the unique set.
- The existing `staged/modified/untracked` arrays are **unchanged** — `GitChangesTab`
  keeps working with no changes.

`packages/api/src/routes/sessions.routes.ts` — `GET /:id/git/status` (~line 151).

- Read `recent` from the query string and pass it through:
  `gitService.status(targetPath, { recent: query.recent === '1' })`.

`packages/ui/src/lib/api.ts` — `getSessionGitStatus` gains an optional
`recent?: boolean` arg that appends `?recent=1`, and the `GitStatus` type gains the
optional `recent` field.

### 2. Frontend — `RecentChangesBar.tsx`

New component `packages/ui/src/components/RecentChangesBar.tsx`.

- Own `useQuery` with key `['session-git-status', sessionId, projectId, 'recent']`
  calling `getSessionGitStatus(..., { recent: true })`, `refetchInterval: 3000`.
  (Separate key from `GitChangesTab` so the plain endpoint stays plain; in terminal
  view `GitChangesTab` isn't mounted, so there's no double poll.)
- Renders a horizontal, `overflow-x-auto` row of chips from `data.recent`, newest
  first. Each chip: file **basename** + a small status dot (modified / untracked /
  staged), full relative path as `title` on hover. Empty state: hidden or a muted
  "No changes".
- Click → `onOpenFile(path)` (wired in `Session.tsx`, see §3).

### 3. Placement + open wiring — `Session.tsx`

`packages/ui/src/pages/Session.tsx`, terminal block (~line 914-923).

- Wrap the terminal in a `flex flex-col`:

  ```tsx
  <div className="flex flex-col h-full min-h-0">
    <div className="flex-1 min-h-0"><Terminal ... /></div>
    <RecentChangesBar
      sessionId={...}
      projectId={...}
      onOpenFile={openFileInManager}
    />
  </div>
  ```

  Strip is fixed height (~`h-8`, `shrink-0`). `Terminal` keeps `flex-1`; the
  FitAddon fits to the reduced height on mount/resize.
- `openFileInManager(path)`:
  ```ts
  setSearchParams(prev => { prev.set('file', path); return prev; });
  setViewMode('files');
  ```
  using react-router `useSearchParams`.

### 4. File manager — open + auto-expand from URL

`packages/ui/src/components/FileExplorer.tsx`:

- Read `const [params] = useSearchParams(); const fileParam = params.get('file');`
- Seed `selectedFile` from `fileParam` (in the existing effect / on mount), and
  clear/override when the param changes. Pass `revealPath={fileParam}` to `FileTree`.

`packages/ui/src/components/FileTree.tsx` (lazy tree — each `TreeDirectory` owns its
own `expanded`, children fetch only when expanded):

- Thread a new `revealPath?: string` prop from `FileTree` → `TreeDirectory` → nested
  `TreeDirectory`.
- In `TreeDirectory`, derive initial expansion:
  ```ts
  const shouldReveal = !!revealPath && revealPath.startsWith(path + '/');
  const [expanded, setExpanded] = useState(defaultExpanded || shouldReveal);
  ```
  This cascades: every ancestor directory on the path to the target opens and loads
  its children, down to the file.
- In `TreeFile`, when `isSelected`, `ref.scrollIntoView({ block: 'nearest' })` in an
  effect so the revealed file is visible.

## Data flow

```
strip mounts (terminal view, active session)
  → GET /git/status?recent=1  (every 3s)
  → git.service.status(..., {recent:true})  → fs.stat changed files → recent[] sorted
  → chips render newest-first
click chip → setSearchParams(file=path) + viewMode='files'
  → FileExplorer reads ?file → selectedFile + revealPath
  → FileTree cascades expand to file, FileViewer opens it, scrollIntoView
```

## Testing

- **Backend:** a small check that `status(path, {recent:true}).recent` is sorted by
  `mtimeMs` desc and only contains changed files; `status(path)` (no flag) omits
  `recent` and still returns the same arrays. Touch a file, assert it moves to front.
- **Frontend:** manual — edit a file, confirm it jumps to the front of the strip
  within ~3s; click it, confirm the file manager opens with the tree expanded to it
  and the viewer showing it; reload with `?file=` present and confirm it reopens.

## Out of scope (skipped)

- Pin / filter the strip (status filter, text match, favorites) — real feature, add
  when asked.
