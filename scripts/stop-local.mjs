import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertAvailablePorts } from './local-ports.mjs';
import { stopLocalSession } from './local-session.mjs';

const root = resolve(import.meta.dirname, '..');

try {
  const stopped = await stopLocalSession();
  if (stopped) console.log('Stopped Kerno, Nodo and the Kaordo site.');
  await assertAvailablePorts([
    { name: 'Kerno', port: 8081 },
    { name: 'Nodo', port: 8082 },
    { name: 'Kaordo site', port: 8765 }
  ]);
  await new Promise((resolveStop, rejectStop) => {
    const child = spawn('docker', [
      'compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yaml', 'stop'
    ], { cwd: root, stdio: 'inherit' });
    child.once('error', () => rejectStop(new Error('Docker Compose is unavailable. No local containers were stopped.')));
    child.once('exit', (code) => code === 0 ? resolveStop() : rejectStop(new Error(`Docker Compose stop failed (${code}).`)));
  });
  console.log('Stopped local Docker services.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
