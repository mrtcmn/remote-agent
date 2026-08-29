import { describe, expect, test } from 'bun:test';
import { buildTree, type ChangeEntry } from './ChangeTree';

const entry = (path: string): ChangeEntry => ({ path, status: 'modified' });

/** Directory labels at one level, in render order. */
const dirNames = (nodes: ReturnType<typeof buildTree>) =>
  nodes.filter((n) => n.kind === 'dir').map((n) => (n as { name: string }).name);

const fileNames = (nodes: ReturnType<typeof buildTree>) =>
  nodes.filter((n) => n.kind === 'file').map((n) => (n as { name: string }).name);

describe('buildTree', () => {
  test('collapses a single-child directory chain into one row', () => {
    const tree = buildTree([entry('packages/ui/src/lib/api.ts')]);
    expect(dirNames(tree)).toEqual(['packages/ui/src/lib']);
    expect(fileNames(tree[0].kind === 'dir' ? tree[0].children : [])).toEqual(['api.ts']);
  });

  test('stops collapsing where a directory branches', () => {
    const tree = buildTree([entry('packages/ui/a.ts'), entry('packages/api/b.ts')]);
    expect(dirNames(tree)).toEqual(['packages']);
    const packages = tree[0].kind === 'dir' ? tree[0].children : [];
    expect(dirNames(packages)).toEqual(['api', 'ui']); // sorted
  });

  test('stops collapsing where a directory holds its own file', () => {
    const tree = buildTree([entry('src/index.ts'), entry('src/lib/util.ts')]);
    expect(dirNames(tree)).toEqual(['src']);
    const src = tree[0].kind === 'dir' ? tree[0].children : [];
    expect(dirNames(src)).toEqual(['lib']);
    expect(fileNames(src)).toEqual(['index.ts']);
  });

  test('keeps root-level files and puts directories first', () => {
    const tree = buildTree([entry('README.md'), entry('src/a.ts')]);
    expect(tree.map((n) => n.kind)).toEqual(['dir', 'file']);
    expect(fileNames(tree)).toEqual(['README.md']);
  });

  test('carries each file entry through unchanged', () => {
    const tree = buildTree([{ path: 'a/b.ts', status: 'untracked' }]);
    const dir = tree[0].kind === 'dir' ? tree[0] : null;
    const file = dir?.children[0];
    expect(file?.kind === 'file' && file.entry).toEqual({ path: 'a/b.ts', status: 'untracked' });
  });
});
