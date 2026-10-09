// Runs regado-agent host tests in a privileged container with real storage tools on loop devices

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const image = 'kaordo-regado-host-test';
const run = (args) => execFileSync('docker', args, { stdio: 'inherit', cwd: root });

run(['build', '--quiet', '--tag', image, 'services/regado-agent/hosttest']);
run([
	'run',
	'--rm',
	'--privileged',
	'--volume',
	`${root}:/src:ro`,
	'--volume',
	'kaordo-host-test-go:/go',
	'--env',
	'GOFLAGS=-buildvcs=false',
	'--env',
	'GOCACHE=/go/cache',
	'--workdir',
	'/src/services/regado-agent',
	image,
	'go',
	'test',
	'-tags',
	'hosttest',
	'-count=1',
	...process.argv.slice(2),
	'./...'
]);
