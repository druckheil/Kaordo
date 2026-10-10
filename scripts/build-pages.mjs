// Assembles independent app builds into the static deployment tree
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createBuildEnvironment } from './build-pages-config.mjs';
import './sync-theme.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/pages');
const apps = ['portal', 'ligo', 'fluo', 'rondo', 'lingvo', 'memoro', 'regado'];
const environment = createBuildEnvironment(process.argv.includes('--production'));

for (const app of apps) {
	await new Promise((resolveBuild, rejectBuild) => {
		const child = spawn('pnpm', ['--filter', `@kaordo/${app}`, 'build'], {
			cwd: root,
			env: environment,
			stdio: 'inherit'
		});
		child.on('error', rejectBuild);
		child.on('exit', (code) =>
			code === 0
				? resolveBuild()
				: rejectBuild(new Error(`${app} build failed with exit code ${code}`))
		);
	});
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const app of apps) {
	await cp(resolve(root, 'apps', app, 'build'), app === 'portal' ? output : resolve(output, app), {
		recursive: true
	});
}
