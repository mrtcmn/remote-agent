import { describe, expect, test } from 'bun:test';
import { attributeContainers, ContainerCache, GRACE_MS, SESSION_LABEL } from './session-containers';
import { parseLabels } from './docker.service';
import type { DockerContainer } from './docker.service';

function container(names: string, labels: Record<string, string> = {}): DockerContainer {
  return {
    id: names,
    names,
    image: 'img',
    status: 'Up',
    state: 'running',
    ports: '',
    createdAt: '',
    labels,
  };
}

const composeAt = (names: string, dir: string) =>
  container(names, { 'com.docker.compose.project.working_dir': dir });

describe('parseLabels', () => {
  test('splits on the first "=" so paths survive', () => {
    expect(parseLabels('a=1,com.docker.compose.project.working_dir=/x/y')).toEqual({
      a: '1',
      'com.docker.compose.project.working_dir': '/x/y',
    });
  });

  test('an unlabelled container yields nothing', () => {
    expect(parseLabels('')).toEqual({});
    expect(parseLabels(undefined)).toEqual({});
  });
});

describe('attributeContainers', () => {
  const sessions = [
    { sessionId: 'proj', path: '/repo' },
    { sessionId: 'tree', path: '/repo/worktrees/auth' },
  ];

  test('a compose stack belongs to the checkout it was brought up from', () => {
    const got = attributeContainers([composeAt('pg', '/repo/infra/db')], sessions);
    expect(got.get('proj')?.map((c) => c.names)).toEqual(['pg']);
  });

  test('the deepest checkout wins, so a worktree beats its project', () => {
    const got = attributeContainers([composeAt('redis', '/repo/worktrees/auth/infra')], sessions);
    expect(got.get('tree')?.map((c) => c.names)).toEqual(['redis']);
    expect(got.has('proj')).toBe(false);
  });

  test('a container from another repo belongs to no session', () => {
    const got = attributeContainers([composeAt('livekit', '/elsewhere/livekit')], sessions);
    expect(got.size).toBe(0);
  });

  test('a hand-started container with no labels belongs to no session', () => {
    expect(attributeContainers([container('hastam-postgres')], sessions).size).toBe(0);
  });

  test('our own label wins outright, wherever the container runs', () => {
    const got = attributeContainers(
      [container('agent-pg', { [SESSION_LABEL]: 'tree', 'com.docker.compose.project.working_dir': '/repo' })],
      sessions
    );
    expect(got.get('tree')?.map((c) => c.names)).toEqual(['agent-pg']);
  });

  test('a label naming a session we do not have is dropped', () => {
    expect(attributeContainers([container('x', { [SESSION_LABEL]: 'gone' })], sessions).size).toBe(0);
  });

  test('a sibling directory is not "inside" a checkout', () => {
    const got = attributeContainers([composeAt('c', '/repo-other/infra')], sessions);
    expect(got.size).toBe(0);
  });
});

describe('ContainerCache', () => {
  test('a failed check keeps the last good answer, then gives up', () => {
    const cache = new ContainerCache();
    cache.record([container('pg')], 1000);
    expect(cache.current(1000 + GRACE_MS - 1).map((c) => c.names)).toEqual(['pg']);
    expect(cache.current(1000 + GRACE_MS)).toEqual([]);
  });

  test('a successful check is the truth and replaces what was there', () => {
    const cache = new ContainerCache();
    cache.record([container('pg'), container('redis')], 1000);
    cache.record([container('pg')], 2000);
    expect(cache.current(2000).map((c) => c.names)).toEqual(['pg']);
  });
});
