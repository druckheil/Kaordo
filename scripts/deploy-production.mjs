// Builds and deploys a complete Kaordo production release in dependency order
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deployPages } from './deploy-pages.mjs';
import { getSourceState, root, run, sshArguments, validateTarget } from './deploy-support.mjs';

const goPackages = [
  ['kerno', './services/kerno/cmd/kerno'],
  ['nodo', './services/nodo/cmd/nodo'],
  ['regado-agent', './services/regado-agent/cmd/regado-agent']
];
const goModules = [
  './services/kerno/...',
  './services/nodo/...',
  './services/mediaauth/...',
  './services/regado-agent/...'
];

function parseOptions(args) {
  const unsupported = args.filter((argument) => argument !== '--allow-dirty');
  if (unsupported.length) throw new Error(`unsupported argument: ${unsupported[0]}`);
  return { allowDirty: args.includes('--allow-dirty') };
}

function releaseId(version, source) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{12}$/.test(source.commit)) {
    throw new Error('Production release requires a semantic version and a 12-character Git commit hash.');
  }
  const createdAt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `v${version}-${source.commit}-${createdAt}${source.dirty ? '-dirty' : ''}`;
}

async function copyReleaseSources(bundle) {
  const trackedSources = await run(
    'git',
    ['ls-files', '-z', '--', 'deploy/nixos', 'deploy/postgres', 'deploy/keycloak', 'scripts/sync-keycloak.mjs'],
    { capture: true }
  );

  for (const source of trackedSources.split('\0').filter(Boolean)) {
    const destination = source === 'scripts/sync-keycloak.mjs'
      ? 'etc/nixos/scripts/sync-keycloak.mjs'
      : `etc/nixos/${source}`;
    const target = join(bundle, destination);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(root, source), target);
  }
}

async function buildReleaseBundle(source) {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const id = releaseId(metadata.version, source);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kaordo-full-release-'));
  const bundle = join(temporaryDirectory, 'bundle');
  const artifact = join(temporaryDirectory, `${id}-full.tar.gz`);
  const binaryDirectory = join(bundle, 'bin');
  try {
    await mkdir(binaryDirectory, { recursive: true });
    await copyReleaseSources(bundle);

    const buildEnvironment = { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' };
    for (const [name, packagePath] of goPackages) {
      await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(binaryDirectory, name), packagePath], {
        env: buildEnvironment
      });
    }

    await writeFile(
      join(bundle, 'RELEASE.txt'),
      [
        'Kaordo full production release',
        `Release: ${id}`,
        `Source commit: ${source.commit}`,
        `Working tree dirty: ${source.dirty}`,
        `Built at: ${new Date().toISOString()}`,
        'Includes static application source configuration, migrations and Linux amd64 backend binaries.',
        'Runtime credentials are read from the production host and are not part of this artifact.',
        ''
      ].join('\n')
    );
    await run('tar', ['-czf', artifact, '-C', bundle, 'bin', 'etc', 'RELEASE.txt']);
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
    return { id, artifact, hash, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function deployBackend(release, target, ssh) {
  const remoteArchive = `/tmp/kaordo-${release.id}-full.tar.gz`;
  const remoteScript = await readFile(join(root, 'deploy/nixos/deploy-release.sh'), 'utf8');
  const remoteCommand = [
    'sudo -n bash -s --',
    release.id,
    release.hash,
    target.origin.hostname,
    target.realm,
    remoteArchive
  ].join(' ');

  try {
    await run('scp', [...ssh, release.artifact, `${target.host}:${remoteArchive}`]);
    await run('ssh', [...ssh, target.host, remoteCommand], { input: remoteScript });
  } finally {
    await rm(release.temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const { allowDirty } = parseOptions(process.argv.slice(2));
  const target = validateTarget();
  const source = await getSourceState(allowDirty);
  const ssh = await sshArguments();
  await run('ssh', [...ssh, target.host, 'sudo -n true']);

  process.stdout.write('Validating production frontend and building static assets…\n');
  await run('pnpm', ['test:pages:production']);
  process.stdout.write('Checking Go services…\n');
  await run('go', ['test', '-race', ...goModules]);
  await run('go', ['vet', ...goModules]);
  await run('node', ['--check', join(root, 'scripts/deploy-production.mjs')]);
  await run('node', ['--check', join(root, 'scripts/deploy-support.mjs')]);
  await run('bash', ['-n', join(root, 'deploy/nixos/deploy-release.sh')]);

  process.stdout.write('Building Linux backend release…\n');
  const release = await buildReleaseBundle(source);
  process.stdout.write(`Deploying backend, configuration and migrations as ${release.id}…\n`);
  await deployBackend(release, target, ssh);

  process.stdout.write('Deploying the verified static frontend…\n');
  try {
    await deployPages({ allowDirty, pagesAlreadyBuilt: true });
  } catch (error) {
    throw new Error(
      `Backend release ${release.id} is active, but the frontend deploy failed; the previous frontend remains active. ${error.message}`
    );
  }
  process.stdout.write(`Full production release ${release.id} is active on ${target.host}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`Full production deployment failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
