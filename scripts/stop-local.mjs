import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const child = spawn('docker', [
  'compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yaml', 'stop'
], { cwd: root, stdio: 'inherit' });
child.once('error', () => {
  console.error('Docker Compose is unavailable. No local containers were stopped.');
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
