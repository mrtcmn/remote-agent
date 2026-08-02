import { test, expect } from 'bun:test';
import { isInsideWorkspaces } from './workspace.service';

// Deleting an in-place project must never rm -rf the user's own folder.
test('in-place folders are never deleted', () => {
  expect(isInsideWorkspaces('/app/workspaces', '/Users/me/code/my-repo')).toBe(false);
  expect(isInsideWorkspaces('/app/workspaces', '/app/workspaces')).toBe(false);
  expect(isInsideWorkspaces('/app/workspaces', '/app/workspaces-evil/x')).toBe(false);
  expect(isInsideWorkspaces('/app/workspaces', '/app/workspaces/u1/../../etc')).toBe(false);
});

test('cloned projects inside the workspaces root are deleted', () => {
  expect(isInsideWorkspaces('/app/workspaces', '/app/workspaces/u1/repo')).toBe(true);
  expect(isInsideWorkspaces('/app/workspaces/', '/app/workspaces/u1/repo')).toBe(true);
});
