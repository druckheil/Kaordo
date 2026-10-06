// Builds and deploys a complete Kaordo production release in dependency order
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSourceState, getSourceState, root, run, sshArguments, validateTarget } from './deploy-support.mjs';

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

export async function prepareReleasePayload(directory, prefix = '') {
  await chmod(directory, 0o755);
  const hashes = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await prepareReleasePayload(path, relative));
    else if (entry.isFile()) {
      await chmod(path, relative.startsWith('bin/') ? 0o755 : 0o644);
      hashes[relative] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    else throw new Error(`Unsupported release entry: ${relative}`);
  }
  return hashes;
}

async function buildReleaseBundle(source, target) {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const id = releaseId(metadata.version, source);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kaordo-full-release-'));
  const bundle = join(temporaryDirectory, 'bundle');
  const artifact = join(temporaryDirectory, `${id}-full.tar.gz`);
  const binaryDirectory = join(bundle, 'bin');
  try {
    await mkdir(binaryDirectory, { recursive: true });
    await copyReleaseSources(bundle);
    await cp(join(root, 'dist/pages'), join(bundle, 'site'), { recursive: true });

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
        `Source commit: ${source.revision}`,
        `Working tree dirty: ${source.dirty}`,
        `Built at: ${new Date().toISOString()}`,
        'Includes static applications, NixOS configuration, Keycloak, migrations and Linux amd64 backend binaries.',
        'Runtime credentials are read from the production host and are not part of this artifact.',
        ''
      ].join('\n')
    );
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
      format: 1,
      release: id,
      sourceCommit: source.revision,
      workingTreeDirty: source.dirty,
      origin: target.origin.origin,
      realm: target.realm,
      files: await prepareReleasePayload(bundle)
    }, null, 2) + '\n');
    await chmod(join(bundle, 'manifest.json'), 0o644);
    await assertSourceState(source);
    await run('tar', ['--no-xattrs', '-czf', artifact, '-C', bundle, 'bin', 'etc', 'site', 'RELEASE.txt', 'manifest.json'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' }
    });
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
    return { id, artifact, hash, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function deployRelease(release, target, ssh) {
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
  if (target.origin.origin !== 'https://kaordo.link' || target.realm !== 'kaordo') {
    throw new Error('The NixOS production configuration declares https://kaordo.link and the kaordo realm.');
  }
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
  await run('pnpm', ['test:deploy']);
  await run('pnpm', ['test:auth']);

  process.stdout.write('Building Linux backend release…\n');
  const release = await buildReleaseBundle(source, target);
  process.stdout.write(`Deploying the complete release ${release.id} from ${source.revision}…\n`);
  await deployRelease(release, target, ssh);
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
