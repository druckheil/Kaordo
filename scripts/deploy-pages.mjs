// Builds, validates and atomically deploys the static production applications
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createBuildEnvironment } from './build-pages-config.mjs';

const root = resolve(import.meta.dirname, '..');
const host = process.env.KAORDO_DEPLOY_HOST;
const allowDirty = process.argv.includes('--allow-dirty');
const identity = process.env.KAORDO_DEPLOY_SSH_KEY || join(homedir(), '.ssh/id_ed25519');
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== '--allow-dirty');

function run(command, args, { input, capture = false, cwd = root, env = process.env } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: input !== undefined ? ['pipe', 'inherit', 'inherit'] : capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    });
    let output = '';

    if (capture) child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    if (input !== undefined) child.stdin.end(input);
    child.on('error', rejectRun);
    child.on('exit', (code) =>
      code === 0 ? resolveRun(output.trim()) : rejectRun(new Error(`${command} exited with code ${code}`))
    );
  });
}

function validateTarget() {
  if (!host || !/^[A-Za-z0-9_.@:-]+$/.test(host)) {
    throw new Error('Set KAORDO_DEPLOY_HOST to a trusted SSH target such as nixos@192.168.178.81');
  }

  const environment = createBuildEnvironment(true);
  const origin = new URL(environment.VITE_KAORDO_AUTH_URL);
  const realm = environment.VITE_KAORDO_AUTH_REALM;
  if (origin.port && origin.port !== '443') throw new Error('Production deployments require the standard HTTPS port');
  if (!/^[A-Za-z0-9.-]+$/.test(origin.hostname)) throw new Error('Production origin must use a DNS hostname');
  if (!/^[A-Za-z0-9._-]+$/.test(realm)) throw new Error('Production Keycloak realm contains unsupported characters');

  return { origin, realm };
}

async function getSourceState() {
  const commit = await run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true });
  const changes = await run('git', ['status', '--porcelain', '--untracked-files=normal'], { capture: true });
  if (changes && !allowDirty) {
    throw new Error('Working tree is not clean. Commit the release or pass --allow-dirty deliberately.');
  }
  return { commit, dirty: Boolean(changes) };
}

async function sshArguments() {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  try {
    await access(identity);
    args.push('-i', identity);
  } catch {
    // OpenSSH may obtain credentials from ssh-agent or its own configuration
  }
  return args;
}

async function createRelease(source, origin) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const createdAt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const release = `v${packageJson.version}-${source.commit}-pages-${createdAt}${source.dirty ? '-dirty' : ''}`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kaordo-pages-release-'));
  const artifact = join(temporaryDirectory, `${release}.tar.gz`);
  const pages = join(root, 'dist/pages');
  const staging = join(temporaryDirectory, 'package');
  try {
    await mkdir(staging, { recursive: true });
    await cp(pages, join(staging, 'site'), { recursive: true });
    await writeFile(
      join(staging, 'RELEASE.txt'),
      [
        'Kaordo static frontend release',
        `Release: ${release}`,
        `Source commit: ${source.commit}`,
        `Working tree dirty: ${source.dirty}`,
        `Public origin: ${origin.origin}`,
        `Built at: ${new Date().toISOString()}`,
        'This release contains no backend binaries or database migrations.',
        ''
      ].join('\n')
    );
    await run('tar', ['-czf', artifact, '-C', staging, 'site', 'RELEASE.txt']);
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
    return { release, temporaryDirectory, artifact, hash };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  if (unsupportedArguments.length) throw new Error(`unsupported argument: ${unsupportedArguments[0]}`);
  const { origin, realm } = validateTarget();
  const source = await getSourceState();
  const ssh = await sshArguments();
  await run('ssh', [...ssh, host, 'sudo -n true']);
  await run('pnpm', ['test:pages:production']);

  const release = await createRelease(source, origin);
  const remoteArchive = `/tmp/kaordo-${release.release}.tar.gz`;
  try {
    await run('scp', [...ssh, release.artifact, `${host}:${remoteArchive}`]);
    const remoteScript = await readFile(join(root, 'deploy/nixos/deploy-static.sh'), 'utf8');
    const remoteCommand = `sudo -n bash -s -- ${release.release} ${release.hash} ${origin.hostname} ${realm} ${remoteArchive}`;
    await run('ssh', [...ssh, host, remoteCommand], { input: remoteScript });
    process.stdout.write(`Deployed ${release.release} to ${host}\n`);
  } finally {
    await rm(release.temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Static deployment failed: ${error.message}\n`);
  process.exitCode = 1;
}
