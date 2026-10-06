// Shares guarded process, target, source and SSH setup across production deploys
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createBuildEnvironment } from './build-pages-config.mjs';

export const root = resolve(import.meta.dirname, '..');

export function run(command, args, { input, capture = false, cwd = root, env = process.env } = {}) {
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
    child.on('close', (code) =>
      code === 0 ? resolveRun(output.trim()) : rejectRun(new Error(`${command} exited with code ${code}`))
    );
  });
}

export function validateTarget(host = process.env.KAORDO_DEPLOY_HOST) {
  if (!host || !/^[A-Za-z0-9_.@:-]+$/.test(host)) {
    throw new Error('Set KAORDO_DEPLOY_HOST to a trusted SSH target such as nixos@192.168.178.81');
  }

  const environment = createBuildEnvironment(true);
  const origin = new URL(environment.VITE_KAORDO_AUTH_URL);
  const realm = environment.VITE_KAORDO_AUTH_REALM;
  if (origin.port && origin.port !== '443') throw new Error('Production deployments require the standard HTTPS port');
  if (!/^[A-Za-z0-9.-]+$/.test(origin.hostname)) throw new Error('Production origin must use a DNS hostname');
  if (!/^[A-Za-z0-9._-]+$/.test(realm)) throw new Error('Production Keycloak realm contains unsupported characters');

  return { host, origin, realm };
}

export async function getSourceState(allowDirty = false, cwd = root) {
  const revision = await run('git', ['rev-parse', 'HEAD'], { capture: true, cwd });
  const changes = await run('git', ['status', '--porcelain', '--untracked-files=normal'], { capture: true, cwd });
  if (changes && !allowDirty) {
    throw new Error('Working tree is not clean. Commit the release or pass --allow-dirty deliberately.');
  }
  const fingerprint = createHash('sha256').update(revision).update(changes);
  if (changes) {
    fingerprint.update(await run('git', ['diff', '--binary', 'HEAD'], { capture: true, cwd }));
    const untracked = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { capture: true, cwd });
    for (const path of untracked.split('\0').filter(Boolean).sort()) {
      fingerprint.update(path).update(await readFile(join(cwd, path)));
    }
  }
  return { commit: revision.slice(0, 12), revision, dirty: Boolean(changes), fingerprint: fingerprint.digest('hex') };
}

export async function assertSourceState(expected, cwd = root) {
  const actual = await getSourceState(expected.dirty, cwd);
  if (actual.fingerprint !== expected.fingerprint) {
    throw new Error('Release source changed during the build. Restart deployment from one unchanged Git snapshot.');
  }
}

export async function sshArguments() {
  const identity = process.env.KAORDO_DEPLOY_SSH_KEY || join(homedir(), '.ssh/id_ed25519');
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  try {
    await access(identity);
    args.push('-i', identity);
  } catch {
    // OpenSSH may obtain credentials from ssh-agent or its own configuration
  }
  return args;
}
