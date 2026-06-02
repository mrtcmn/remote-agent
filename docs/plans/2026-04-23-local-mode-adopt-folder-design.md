# Local Mode: Adopt Existing Folder as Project

**Date:** 2026-04-23
**Status:** Design
**Scope:** `packages/api`, `packages/ui`
**Mode:** Local only

## Problem

In local mode, users already have git repositories on their filesystem
(`~/code/foo`, `~/work/bar`). The current project-create flow only supports
cloning from a URL or initializing an empty repo. There is no path to register
an existing local folder as a project.

## Goal

Let the user point at an existing local folder that contains a git repository
and get a fully functional project entry — with workspaces, worktrees, sessions,
and PR flows working identically to a cloned project.

## Non-Goals

- Any support in remote mode (server has no access to user filesystem).
- Symlinks or in-place adoption. The source folder stays untouched.
- Importing uncommitted/dirty working-tree state.

## Approach

Copy the source folder into the standard workspaces root by cloning it locally
and then topping up with non-ignored untracked files. The result is an
independent git repo at `~/remote-agent/workspaces/<userId>/<name>/` that
behaves exactly like a fresh clone.

### Copy mechanic

1. Read `remote.origin.url` (and optionally other remotes) from the source
   `.git/config` before touching anything.
2. `git status --porcelain` on the source. If non-empty and the caller did not
   pass `allowDirty: true`, return `409` with the list of changed files and
   stop. The UI surfaces a confirm modal; on confirm it retries with
   `allowDirty: true`.
3. `git clone --no-hardlinks <sourcePath> <destPath>` — brings over full
   history, branches, tags, and the committed tree.
4. `git remote set-url origin <originalOriginUrl>` on the destination so
   fetch/pull/push/PR flows hit the real remote (not the local source path).
   If the source had no origin, skip this step and leave the project
   origin-less (user can add one later).
5. `git -C <sourcePath> ls-files --others --exclude-standard -z` — enumerate
   untracked-but-not-gitignored files, copy each into the destination. This
   picks up things like an uncommitted `.env.local` the user wants, while
   `node_modules/`, `dist/`, etc. stay behind because they are gitignored.

Uncommitted edits to tracked files are **not** carried over; the warning in
step 2 tells the user this.

### What is preserved vs. dropped

| Preserved                               | Dropped                            |
| --------------------------------------- | ---------------------------------- |
| Commit history, branches, tags          | Uncommitted edits to tracked files |
| Non-ignored untracked files             | Gitignored files (node_modules, …) |
| Original `origin` remote URL            | Stashes (clone does not copy them) |
| Default branch                          | Local `.git/hooks` (clone resets)  |

Stashes and custom hooks not being carried over is acceptable for v1; the user
can re-stash in the copy or reinstall hooks.

## API

Extend `POST /projects` rather than adding a new endpoint. This keeps all
create logic in one place.

```ts
body: {
  name: string;
  description?: string;
  // existing
  repoUrl?: string;
  branch?: string;
  sshKeyId?: string;
  githubAppInstallationId?: string;
  githubRepoFullName?: string;
  // NEW
  sourcePath?: string;    // absolute path to existing local git repo
  allowDirty?: boolean;   // user confirmed copy-despite-dirty
}
```

Server flow when `sourcePath` is set:

1. Guard: `isLocalMode()` — otherwise 400.
2. Validate `sourcePath`: absolute, exists, is a directory, contains `.git`.
3. If `!allowDirty` and `git status --porcelain` is non-empty, return
   `409 { error: 'dirty', changedFiles: string[] }`.
4. Run the copy mechanic above; compute `localPath` under
   `getWorkspacesRoot()/<userId>/<name>/`.
5. Insert project row with `repoUrl` set to the preserved origin URL (or null),
   `defaultBranch` detected from `HEAD`.

### Path validation

- Reject relative paths, `~` expansion must be done client-side (or server
  expands `~` only for the authenticated user's home).
- Reject paths that already resolve under `getWorkspacesRoot()` — avoids
  recursive copies.
- Reject if destination `<workspaces>/<userId>/<name>/` already exists.

## UI

New entry in the "Add project" flow (alongside "Clone from URL" and "Create
empty"): **"Add existing local folder"** — local-mode only, hidden in remote.

Form:

- **Folder path** (text input, absolute path). Placeholder: `/Users/.../my-repo`.
- **Project name** (defaults to basename of the path; editable).
- Submit → calls `POST /projects` with `sourcePath`.

Dirty-folder confirm modal:

- Triggered by `409 { dirty: true, changedFiles }` response.
- Lists up to ~20 changed files (with "and N more" if longer).
- Copy: *"This folder has uncommitted changes. Only committed files will be
  copied — your local edits stay in the original folder. Continue?"*
- Buttons: **Copy anyway** (resubmits with `allowDirty: true`) / **Cancel**.

v1 uses a plain text input. A server-backed folder browser (`GET /fs/browse`)
is a nice follow-up but not required. A localStorage-backed "recent paths"
dropdown is a cheap convenience worth including.

## Files touched

- `packages/api/src/services/git.ts` — new `adoptLocalRepo({ sourcePath, destPath, allowDirty })` returning `{ localPath, repoUrl, defaultBranch }` or throwing a dirty-state error.
- `packages/api/src/routes/projects.routes.ts` — new branch in the `POST /` handler for `sourcePath`; 409 response for dirty state.
- `packages/ui/src/components/NewProjectModal.tsx` (or wherever the add-project UI lives) — new tab/mode, dirty-confirm dialog.
- `packages/ui/src/lib/api.ts` — types for the new body fields and 409 shape.

## Error cases

| Case                                  | Response                            |
| ------------------------------------- | ----------------------------------- |
| Not local mode                        | 400 `{ error: 'local mode only' }`  |
| Path does not exist / not a directory | 400 `{ error: 'invalid path' }`     |
| No `.git` in source                   | 400 `{ error: 'not a git repo' }`   |
| Source resolves inside workspaces     | 400 `{ error: 'source is inside workspaces root' }` |
| Dirty, no `allowDirty`                | 409 `{ error: 'dirty', changedFiles }` |
| Destination already exists            | 409 `{ error: 'project name taken' }` |
| Copy failed mid-way                   | 500, roll back partial destination dir |

## Testing

- Unit: `adoptLocalRepo` against a fixture repo with tracked, untracked-ignored,
  untracked-not-ignored, and dirty-tracked files. Assert preserved/dropped
  matches the table above.
- Unit: origin URL preservation when source origin is set vs. unset.
- Integration: `POST /projects` with `sourcePath` from a local fixture;
  assert 409 on dirty, 200 on `allowDirty: true`, project row created.
- Manual: run in local mode, add a real repo with `node_modules`, confirm
  destination has no `node_modules` and git history is intact.
