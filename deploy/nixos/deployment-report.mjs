// Persists deployment phases, download progress and a bounded, sanitized installation journal

import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const journalLimit = 300;
const messageLimit = 2000;

export function cleanMessage(value, secrets = []) {
	let message = Array.from(stripVTControlCharacters(String(value)))
		.filter((character) => {
			const code = character.codePointAt(0);
			return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
		})
		.join('');
	for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[redacted]');
	return message
		.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
		.replace(/\b(password|token|secret)=\S+/gi, '$1=[redacted]')
		.slice(0, messageLimit);
}

export async function createDeploymentReport(directory, request, secrets = []) {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${request.run}.json`);
	const startedAt = new Date().toISOString();
	let entry = {
		...request,
		state: 'waiting',
		phase: 'queued',
		message: 'Waiting for the deployment lock.',
		startedAt,
		updatedAt: startedAt,
		rollback: 'not_needed',
		events: []
	};
	try {
		const previous = JSON.parse(await readFile(path, 'utf8'));
		if (previous.attempt === request.attempt && previous.state === 'waiting')
			entry = { ...entry, ...previous };
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	let sequence = entry.events.at(-1)?.sequence ?? 0;
	let pending = Promise.resolve();
	const report = (change = {}, event) => {
		// Child output, heartbeat and download callbacks share one ordered atomic writer
		pending = pending.then(async () => {
			const at = new Date().toISOString();
			const next = { ...change };
			if (next.message !== undefined) next.message = cleanMessage(next.message, secrets);
			if (next.error)
				next.error = { ...next.error, message: cleanMessage(next.error.message, secrets) };
			entry = { ...entry, ...next, updatedAt: at };
			if (event) {
				entry.events = [
					...entry.events,
					{
						sequence: ++sequence,
						at,
						phase: entry.phase,
						level: event.level ?? 'info',
						message: cleanMessage(event.message, secrets)
					}
				].slice(-journalLimit);
			}
			if (['succeeded', 'superseded', 'failed'].includes(entry.state)) entry.finishedAt = at;
			const file = await open(`${path}.new`, 'w', 0o600);
			try {
				await file.writeFile(JSON.stringify(entry) + '\n');
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(`${path}.new`, path);
			const parent = await open(directory, 'r');
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		});
		return pending;
	};
	return {
		get entry() {
			return entry;
		},
		report,
		phase: (phase, message) =>
			report(
				{
					state: 'deploying',
					phase,
					message,
					progress: undefined,
					hostChanged: entry.hostChanged === true || phase === 'configuration'
				},
				{ message }
			),
		async output(line, level = 'info') {
			const phase = /^KAORDO_DEPLOY_PHASE=([a-z_]+) (.+)$/.exec(line);
			if (phase) return this.phase(phase[1], phase[2]);
			const rollback = /^KAORDO_DEPLOY_ROLLBACK=(running|succeeded|failed)$/.exec(line);
			if (rollback)
				return report(
					{ rollback: rollback[1], hostChanged: rollback[1] !== 'succeeded' },
					{ message: `Rollback ${rollback[1]}.` }
				);
			if (line === 'KAORDO_DEPLOY_HOST_CHANGED=0') return report({ hostChanged: false });
			const failure = /^KAORDO_DEPLOY_ERROR=(.+)$/.exec(line);
			if (failure)
				return report(
					{
						error: entry.error ?? {
							phase: /^Step ([a-z_]+) failed/.exec(failure[1])?.[1] ?? entry.phase,
							message: failure[1]
						}
					},
					{ level: 'error', message: failure[1] }
				);
			return report({}, { level, message: line });
		}
	};
}
