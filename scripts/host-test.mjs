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
	'sh',
	'-c',
	// A real host's devtmpfs creates partition nodes; a container's /dev is a static tmpfs.
	// Packages run one at a time because loop devices and the Btrfs device cache are kernel-wide.
	'mount -t devtmpfs devtmpfs /dev && exec go test -tags hosttest -count=1 -p 1 "$@" ./...',
	'host-test',
	...process.argv.slice(2)
]);
