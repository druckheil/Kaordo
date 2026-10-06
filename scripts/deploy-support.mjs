// Shares guarded process, target, source and SSH setup across production deploys
import { access } from 'node:fs/promises';
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

export async function getSourceState(allowDirty = false) {
  const commit = await run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true });
  const changes = await run('git', ['status', '--porcelain', '--untracked-files=normal'], { capture: true });
  if (changes && !allowDirty) {
    throw new Error('Working tree is not clean. Commit the release or pass --allow-dirty deliberately.');
  }
  return { commit, dirty: Boolean(changes) };
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
