// Stops the current checkout's local services and development servers

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertAvailablePorts } from './local-ports.mjs';
import { stopLocalSession } from './local-session.mjs';
import { localDevelopmentPorts } from './local-vite.mjs';

const root = resolve(import.meta.dirname, '..');

try {
	const stopped = await stopLocalSession();
	if (stopped) console.log('Stopped Kerno, Nodo and the frontend development servers.');
	await assertAvailablePorts(localDevelopmentPorts);
	await new Promise((resolveStop, rejectStop) => {
		const child = spawn(
			'docker',
			['compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yaml', 'stop'],
			{
				cwd: root,
				stdio: 'inherit',
				env: {
					...process.env,
					LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || 'stop-only',
					LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || 'stop-only'
				}
			}
		);
		child.once('error', () =>
			rejectStop(new Error('Docker Compose is unavailable. No local containers were stopped.'))
		);
		child.once('exit', (code) =>
			code === 0 ? resolveStop() : rejectStop(new Error(`Docker Compose stop failed (${code}).`))
		);
	});
	console.log('Stopped local Docker services.');
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
