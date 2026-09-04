import { dirname, resolve } from 'node:path';
import type { DockerContainer } from './docker.service';

/**
 * Attributing a container to a session.
 *
 * Nothing about a container is stored on our side — Docker already keeps the
 * record, we just have to read it. Two labels answer "who started this?":
 *
 *  - `com.remote-agent.session` — stamped by our own `docker run`, exact.
 *  - `com.docker.compose.project.working_dir` — stamped by compose on every
 *    container it brings up. It is a real path, so a container belongs to the
 *    session whose checkout contains it.
 *
 * A container started by hand outside the app carries neither and belongs to
 * no session, which is the honest answer.
 */

export const SESSION_LABEL = 'com.remote-agent.session';
const COMPOSE_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_FILES_LABEL = 'com.docker.compose.project.config_files';

/** A session and the checkout it works in. */
export interface SessionPath {
  sessionId: string;
  path: string;
}

/** The directory a compose stack was brought up from, if it is one. */
function composeDir(container: DockerContainer): string | null {
  const dir = container.labels[COMPOSE_DIR_LABEL];
  if (dir) return dir;
  // Older compose versions only wrote the config file list.
  const files = container.labels[COMPOSE_FILES_LABEL];
  return files ? dirname(files.split(',')[0]) : null;
}

/** True when `child` is `parent` itself or sits underneath it. */
function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/**
 * Map each container to the session that owns it. Our own label wins outright;
 * otherwise the deepest containing checkout does, so a worktree beats the
 * project it lives under.
 */
export function attributeContainers(
  containers: DockerContainer[],
  sessions: SessionPath[]
): Map<string, DockerContainer[]> {
  const out = new Map<string, DockerContainer[]>();
  const add = (sessionId: string, container: DockerContainer) => {
    const list = out.get(sessionId);
    if (list) list.push(container);
    else out.set(sessionId, [container]);
  };

  for (const container of containers) {
    const stamped = container.labels[SESSION_LABEL];
    if (stamped) {
      if (sessions.some((s) => s.sessionId === stamped)) add(stamped, container);
      continue;
    }

    const dir = composeDir(container);
    if (!dir) continue;

    let best: SessionPath | null = null;
    for (const session of sessions) {
      if (!session.path || !isInside(session.path, dir)) continue;
      if (!best || session.path.length > best.path.length) best = session;
    }
    if (best) add(best.sessionId, container);
  }

  return out;
}

/**
 * `docker ps` is not always answerable — the daemon stalls, the socket goes
 * away — and a failed call must not blank every container row in the sidebar.
 * A successful listing is the truth and replaces the cache outright; while
 * calls are failing the last good answer stands, and after `GRACE_MS` of no
 * successful check the containers are dropped.
 */
export const GRACE_MS = 30_000;

export class ContainerCache {
  private containers: DockerContainer[] = [];
  private seenAt = 0;

  /** Record a successful listing. */
  record(containers: DockerContainer[], now: number = Date.now()): void {
    this.containers = containers;
    this.seenAt = now;
  }

  /** The containers to show: the last good listing, until it goes stale. */
  current(now: number = Date.now()): DockerContainer[] {
    return now - this.seenAt < GRACE_MS ? this.containers : [];
  }
}
