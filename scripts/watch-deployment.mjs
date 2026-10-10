// Monitors an idempotent production request and renders progress, reconnections and final diagnostics

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { cleanMessage } from '../deploy/nixos/deployment-report.mjs';

const finalStates = new Set(['succeeded', 'superseded', 'failed']);
const states = new Set(['waiting', 'deploying', ...finalStates]);
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const escapeMarkdown = (value) =>
	cleanMessage(value).replace(/[|`<>]/g, (character) => `&#${character.charCodeAt(0)};`);
const annotation = (value) =>
	cleanMessage(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export function deploymentSummary(report, origin, elapsed, monitoringError = '') {
	const lines = [
		'### Production deployment',
		'',
		`[Open deployment history and journal](${origin}/regado/?view=deployments&run=${report.run})`,
		'',
		'| Detail | Value |',
		'| --- | --- |',
		`| Run / attempt | ${report.run} / ${report.attempt ?? 'pending'} |`,
		`| State | ${escapeMarkdown(report.state)} |`,
		`| Phase | ${escapeMarkdown(report.phase ?? 'request')} |`,
		`| Revision | ${escapeMarkdown(report.revision ?? 'pending')} |`,
		`| Release | ${escapeMarkdown(report.release ?? 'pending')} |`,
		`| Previous release | ${escapeMarkdown(report.previousRelease ?? 'unknown')} |`,
		`| Rollback | ${escapeMarkdown(report.rollback ?? 'not needed')} |`,
		`| Elapsed | ${Math.round(elapsed / 1000)} s |`,
		'',
		escapeMarkdown(report.message ?? 'Requesting deployment.')
	];
	if (report.progress)
		lines.push(
			'',
			`Download: ${report.progress.receivedBytes} / ${report.progress.totalBytes} bytes.`
		);
	if (report.error)
		lines.push(
			'',
			`**Failed phase: ${escapeMarkdown(report.error.phase)}.** ${escapeMarkdown(report.error.message)}`
		);
	if (monitoringError) lines.push('', `**Monitoring error:** ${escapeMarkdown(monitoringError)}`);
	if (report.events?.length) {
		lines.push('', '<details><summary>Latest installation journal</summary>', '', '```text');
		for (const event of report.events.slice(-100))
			lines.push(
				`${event.at} [${event.phase}] ${cleanMessage(event.message).replaceAll('```', "'''")}`
			);
		lines.push('```', '', '</details>');
	}
	return lines.join('\n') + '\n';
}

export async function monitorDeployment({
	run,
	attempt,
	revision,
	request,
	log = console.log,
	summary = async () => {},
	now = Date.now,
	sleep = (milliseconds) => delay(milliseconds),
	pollMs = 5000,
	timeoutMs = 32 * 60_000,
	reconnectMs = 5 * 60_000
}) {
	const started = now();
	let lastConnection = started;
	let accepted = false;
	let report = {
		run,
		attempt,
		state: 'waiting',
		phase: 'request',
		message: 'Requesting deployment.'
	};
	let sequence = 0;
	let previousPhase = '';
	let previousProgress = '';
	let lastStatusLog = started;
	await summary(report, 0);
	try {
		while (now() - started < timeoutMs) {
			try {
				const result = await request(accepted ? 'GET' : 'POST', accepted ? `/${run}` : '');
				if (
					result.run !== run ||
					result.attempt !== attempt ||
					!states.has(result.state) ||
					(revision && result.revision !== revision)
				)
					throw new Error(
						'Production returned a different attempt or an invalid deployment state.'
					);
				if (now() - lastConnection > pollMs * 2)
					log('Production API reconnected; continuing the same deployment attempt.');
				lastConnection = now();
				accepted = true;
				report = result;
				if (report.phase !== previousPhase) {
					log(`[${report.phase ?? report.state}] ${cleanMessage(report.message ?? '')}`);
					previousPhase = report.phase;
				}
				if (now() - lastStatusLog >= 15_000) {
					log(
						`[${report.phase ?? report.state}] ${report.state} · ${Math.round((now() - started) / 1000)} s elapsed · server update ${report.updatedAt ?? 'pending'}`
					);
					lastStatusLog = now();
				}
				const events = report.events ?? [];
				if (events.length && events[0].sequence > sequence + 1)
					log(
						'Earlier journal entries rolled out of the server window; showing the available tail.'
					);
				for (const event of events)
					if (event.sequence > sequence) {
						log(`${event.at} [${event.phase}] [${event.level}] ${cleanMessage(event.message)}`);
						sequence = event.sequence;
					}
				if (report.progress) {
					const { receivedBytes, totalBytes } = report.progress;
					const progress = `${receivedBytes} / ${totalBytes} bytes (${Math.floor((receivedBytes / totalBytes) * 100)}%)`;
					if (progress !== previousProgress) {
						log(`[download] ${progress}`);
						previousProgress = progress;
					}
				}
				await summary(report, now() - started);
				if (finalStates.has(report.state)) {
					log(`${report.state}: ${cleanMessage(report.message ?? '')}`);
					return report;
				}
			} catch (error) {
				if (!error.transient) throw error;
				const disconnected = now() - lastConnection;
				log(
					`Production API unavailable for ${Math.round(disconnected / 1000)} s; reconnecting. ${cleanMessage(error.message)}`
				);
				await summary(report, now() - started, error.message);
				if (disconnected >= reconnectMs)
					throw new Error(
						`Production could not be reached for ${Math.round(reconnectMs / 60_000)} minutes. Last known phase: ${report.phase}. The server may still be deploying; inspect Regado or the deployment unit journal.`,
						{ cause: error }
					);
			}
			await sleep(pollMs);
		}
		throw new Error(
			`The deployment monitor reached its deadline. Last known state: ${report.state}, phase: ${report.phase}. The server may still be deploying; inspect Regado or the deployment unit journal.`
		);
	} catch (error) {
		await summary(report, now() - started, error.message);
		throw error;
	}
}

export function productionRequest(origin, environment = process.env, fetcher = fetch) {
	return async (method, path) => {
		try {
			const url = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
			url.searchParams.set('audience', origin);
			const tokenResponse = await fetcher(url, {
				headers: { Authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
				signal: AbortSignal.timeout(10_000)
			});
			if (!tokenResponse.ok)
				throw Object.assign(new Error(`GitHub OIDC returned HTTP ${tokenResponse.status}.`), {
					transient: transientStatuses.has(tokenResponse.status)
				});
			const { value } = await tokenResponse.json();
			if (typeof value !== 'string' || !value)
				throw new Error('GitHub did not return an OIDC token.');
			const response = await fetcher(`${origin}/v1/deployments${path}`, {
				method,
				headers: { Authorization: `Bearer ${value}` },
				signal: AbortSignal.timeout(15_000)
			});
			if (!response.ok) {
				const body = await response.json().catch(() => null);
				const detail = typeof body?.error === 'string' ? ` ${cleanMessage(body.error)}` : '';
				throw Object.assign(new Error(`Production returned HTTP ${response.status}.${detail}`), {
					transient: transientStatuses.has(response.status)
				});
			}
			return await response.json();
		} catch (error) {
			if (error.transient !== undefined) throw error;
			if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name))
				throw Object.assign(new Error('The production status request could not complete.'), {
					transient: true
				});
			throw error;
		}
	};
}

async function main() {
	const run = Number(process.env.GITHUB_RUN_ID);
	const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
	const origin = process.env.ORIGIN;
	if (
		!Number.isSafeInteger(run) ||
		run < 1 ||
		!Number.isSafeInteger(attempt) ||
		attempt < 1 ||
		origin !== 'https://kaordo.link'
	)
		throw new Error('A production Actions run and attempt are required.');
	const result = await monitorDeployment({
		run,
		attempt,
		revision: process.env.GITHUB_SHA,
		request: productionRequest(origin),
		summary: (report, elapsed, error) =>
			writeFile(process.env.GITHUB_STEP_SUMMARY, deploymentSummary(report, origin, elapsed, error))
	});
	if (result.state === 'failed') throw new Error(result.message ?? 'Production deployment failed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main().catch((error) => {
		console.error(`::error::${annotation(error.message)}`);
		process.exitCode = 1;
	});
}
