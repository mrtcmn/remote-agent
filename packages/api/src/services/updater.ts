import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** How this machine was installed, which decides how it can replace itself. */
export type InstallKind = 'docker' | 'host' | 'none';
export type UpdateState = 'idle' | 'running' | 'ok' | 'failed' | 'rolled-back';

const REPO = resolve(import.meta.dir, '../../../..');
const SCRIPT = join(REPO, 'scripts', 'self-update.sh');
const HELPER = 'remote-agent-updater';
const UNIT = 'remote-agent-update';
/** Host install: <install dir>/app is the checkout (see install.sh). */
const INSTALL_DIR = dirname(REPO);
const HOST_LOG = join(INSTALL_DIR, 'backups', 'update.log');

export function installKind(): InstallKind {
  if (existsSync('/.dockerenv') && existsSync('/var/run/docker.sock')) return 'docker';
  if (process.platform === 'linux' && process.env.INVOCATION_ID
    && existsSync(join(REPO, '.git')) && existsSync('/etc/systemd/system/remote-agent.service')) return 'host';
  // The desktop app and a dev checkout: the user updates those.
  return 'none';
}

async function run(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { ok: code === 0, out: (out + err).trim() };
  } catch (err) {
    return { ok: false, out: (err as Error).message };
  }
}

/** The state the log's last RESULT line names; null while the script still runs. */
export function resultOf(lines: string[]): { state: UpdateState; detail: string } | null {
  const line = [...lines].reverse().find((l) => l.startsWith('RESULT: '));
  if (!line) return null;
  const detail = line.slice('RESULT: '.length);
  const state: UpdateState = detail.startsWith('OK') ? 'ok' : detail.startsWith('ROLLED BACK') ? 'rolled-back' : 'failed';
  return { state, detail };
}

class Updater {
  /** Steps before the script starts (the image pull), kept in memory. */
  private prelude: string[] = [];
  private starting = false;

  async status(): Promise<{ state: UpdateState; detail: string | null; log: string[] }> {
    if (this.starting) return { state: 'running', detail: null, log: this.prelude };

    const kind = installKind();
    let lines: string[] = [];
    let alive = false;
    if (kind === 'docker') {
      const logs = await run(['docker', 'logs', '--tail', '40', HELPER]);
      if (logs.ok) lines = logs.out.split('\n').filter(Boolean);
      alive = (await run(['docker', 'inspect', '-f', '{{.State.Running}}', HELPER])).out === 'true';
    } else if (kind === 'host') {
      if (existsSync(HOST_LOG)) lines = readFileSync(HOST_LOG, 'utf8').split('\n').filter(Boolean).slice(-40);
      alive = (await run(['systemctl', 'is-active', UNIT])).out === 'active';
    }

    const result = resultOf(lines);
    if (result) return { ...result, log: lines };
    if (alive) return { state: 'running', detail: null, log: lines };
    // No result and nothing runs: either no update yet, or the last one died.
    const failed = lines.length > 0 || this.prelude.some((l) => l.startsWith('FAILED'));
    return failed
      ? { state: 'failed', detail: this.prelude.at(-1) ?? 'The update stopped with no result', log: [...this.prelude, ...lines] }
      : { state: 'idle', detail: null, log: [] };
  }

  /** Starts the update and returns at once; follow it with status(). */
  async start(target: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!/^v\d+\.\d+\.\d+$/.test(target)) return { ok: false, error: `Not a version: ${target}` };
    const kind = installKind();
    if (kind === 'none') return { ok: false, error: 'This install cannot update itself' };
    if ((await this.status()).state === 'running') return { ok: false, error: 'An update runs now' };

    this.starting = true;
    this.prelude = [`Update to ${target} started`];
    const job = kind === 'docker' ? this.startDocker(target) : this.startHost(target);
    job
      .catch((err) => { this.prelude.push(`FAILED ${(err as Error).message}`); })
      .finally(() => { this.starting = false; });
    return { ok: true };
  }

  private async startDocker(target: string): Promise<void> {
    // In a container the hostname is the container id.
    const inspect = await run(['docker', 'inspect', os.hostname()]);
    if (!inspect.ok) throw new Error('Cannot find the container of this app');
    const self = JSON.parse(inspect.out)[0] as { Image: string; Config: { Image: string; Labels: Record<string, string> } };
    const labels = self.Config.Labels ?? {};
    const project = labels['com.docker.compose.project'];
    const workdir = labels['com.docker.compose.project.working_dir'];
    const files = labels['com.docker.compose.project.config_files'];
    const service = labels['com.docker.compose.service'];
    if (!project || !workdir || !files || !service) throw new Error('This container was not started by docker compose');
    const ref = self.Config.Image;
    const repo = ref.lastIndexOf(':') > ref.lastIndexOf('/') ? ref.slice(0, ref.lastIndexOf(':')) : ref;

    // The helper comes from the target image, so it runs that version's script.
    this.prelude.push(`Pull ${repo}:${target}...`);
    const pull = await run(['docker', 'pull', '-q', `${repo}:${target}`]);
    if (!pull.ok) throw new Error(`Cannot pull ${repo}:${target}: ${pull.out.split('\n').at(-1)}`);

    await run(['docker', 'rm', '-f', HELPER]);
    const started = await run([
      'docker', 'run', '-d', '--name', HELPER, '--user', 'root',
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${workdir}:${workdir}`,
      '--entrypoint', 'bash', `${repo}:${target}`,
      '/app/scripts/self-update.sh', 'docker', target, project, files, workdir, service, self.Image, repo,
    ]);
    if (!started.ok) throw new Error(`Cannot start the update helper: ${started.out.split('\n').at(-1)}`);
  }

  private async startHost(target: string): Promise<void> {
    // git replaces the checkout mid-run; bash must not read a script that changes.
    const copy = join(os.tmpdir(), 'remote-agent-self-update.sh');
    copyFileSync(SCRIPT, copy);
    mkdirSync(dirname(HOST_LOG), { recursive: true });
    await run(['systemctl', 'reset-failed', UNIT]);
    const env = ['DATABASE_URL', 'PATH', 'HOME', 'PORT'].flatMap((k) => (process.env[k] ? [`--setenv=${k}=${process.env[k]}`] : []));
    // Its own unit: it must live through the restart of remote-agent.service.
    const started = await run([
      'systemd-run', `--unit=${UNIT}`, '--collect', ...env,
      'bash', '-c', `exec bash "${copy}" host "${target}" "${INSTALL_DIR}" > "${HOST_LOG}" 2>&1`,
    ]);
    if (!started.ok) throw new Error(`Cannot start the update: ${started.out.split('\n').at(-1)}`);
  }
}

export const updater = new Updater();
