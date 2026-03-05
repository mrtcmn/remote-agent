# Remote Agent - Global Session Rules

These rules apply to every Claude Code session running on this platform.

## Commits

You are allowed to commit code. But after EVERY commit, you MUST run these quality checks in order:

### 1. Self Code Review
- Run `git diff HEAD~1` and review your own changes
- Check for: security issues, leftover debug code, missing error handling at boundaries, unintended changes
- If you find issues, fix them in a new commit

### 2. TypeScript Check
Run the project's TypeScript checker. Common patterns:
```bash
npx tsc --noEmit        # standard
bun run tsc --noEmit    # bun projects
```
Adapt to the project's setup. If this fails, fix the errors and commit again.

### 3. Build Check
Run the project's build command:
```bash
npm run build    # or bun run build, pnpm build, etc.
```
If this fails, fix the errors and commit again.

### 4. Lint Check
If the project has a linter configured, run it:
```bash
npm run lint     # or bun run lint, etc.
```
If no lint script exists, skip this step.

## UI Testing

When you create or modify UI components (React, Vue, Svelte, HTML, etc.), you MUST test them visually using the agent-browser skill before committing. Do not commit UI changes without visual verification.

## General Rules

- Read the project's own CLAUDE.md, README, or docs before making changes
- Use existing patterns in the codebase — read neighboring files before writing new code
- Keep commits small and focused — one logical change per commit
- Do not push to remote unless explicitly asked
