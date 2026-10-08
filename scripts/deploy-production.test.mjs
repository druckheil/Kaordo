// Exercises release drift detection, public theme verification and coordinated host rollback
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, cp, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assertSourceState, getSourceState } from './deploy-support.mjs';
import { prepareReleasePayload } from './deploy-production.mjs';
import { verifyLiveRelease, verifyPayload } from '../deploy/nixos/verify-release.mjs';

const root = resolve(import.meta.dirname, '..');
const release = 'v0.0.2-81f634504b64-20261006T120000Z';
const origin = 'https://kaordo.link';
const revision = '81f634504b64dd43aa99892bb1bb318c1c50d31f';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function put(path, content) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, content);
}

test('payload preparation gives services access to configuration regardless of builder umask', async () => {
  const directory = await mkdtemp('/tmp/kd-permissions-');
  try {
    for (const path of ['bin/kerno', 'etc/nixos/deploy/postgres/001.sql', 'site/index.html']) {
      await put(join(directory, path), path);
      await chmod(join(directory, path), 0o600);
    }
    await chmod(join(directory, 'etc/nixos/deploy/postgres'), 0o700);
    const hashes = await prepareReleasePayload(directory);
    assert.equal((await stat(join(directory, 'etc/nixos/deploy/postgres'))).mode & 0o777, 0o755);
    assert.equal((await stat(join(directory, 'etc/nixos/deploy/postgres/001.sql'))).mode & 0o777, 0o644);
    assert.equal((await stat(join(directory, 'bin/kerno'))).mode & 0o777, 0o755);
    assert.equal(hashes['site/index.html'], hash('site/index.html'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function payloadFixture() {
  const directory = await mkdtemp('/tmp/kd-payload-');
  const files = {
    'bin/kerno': 'new-kerno', 'bin/nodo': 'new-nodo', 'bin/regado-agent': 'new-agent',
    'etc/nixos/deploy/nixos/kaordo.nix': 'new-nix',
    'etc/nixos/deploy/nixos/kaordo-realm.json': '{"rememberMe":true}',
    'etc/nixos/deploy/nixos/sync-keycloak-production.mjs': 'new-sync',
    'etc/nixos/scripts/sync-keycloak.mjs': 'new-shared-sync',
    'etc/nixos/deploy/keycloak/themes/kaordo/login/resources/js/session.js': 'new-session-script',
    'etc/nixos/deploy/keycloak/themes/kaordo/login/theme.properties': 'scripts=js/session.js\n',
    'site/index.html': 'new-portal', 'site/fluo/index.html': 'new-fluo',
    'site/ligo/index.html': 'new-ligo', 'site/rondo/index.html': 'new-rondo',
    'site/lingvo/index.html': 'new-lingvo', 'site/memoro/index.html': 'new-memoro', 'site/regado/index.html': 'new-regado', 'site/silent-check-sso.html': 'new-sso'
  };
  for (const [path, bytes] of Object.entries(files)) await put(join(directory, path), bytes);
  const manifest = { format: 1, release, sourceCommit: revision, origin, realm: 'kaordo', files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(bytes)])) };
  await put(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const dataRoot = join(directory, 'host');
  const configurationRoot = join(directory, 'configuration');
  await cp(join(directory, 'bin'), join(dataRoot, 'bin'), { recursive: true });
  await cp(join(directory, 'site'), join(dataRoot, 'www/current'), { recursive: true });
  await cp(join(directory, 'etc/nixos'), configurationRoot, { recursive: true });
  return { directory, manifest, files, dataRoot, configurationRoot };
}

test('release verification rejects missing or corrupted components before activation', async () => {
  const fixture = await payloadFixture();
  try {
    await verifyPayload(fixture.directory, release, origin, 'kaordo');
    await put(join(fixture.directory, 'bin/kerno'), 'old-kerno');
    await assert.rejects(verifyPayload(fixture.directory, release, origin, 'kaordo'), /payload differs.*bin\/kerno/);
    delete fixture.manifest.files['bin/kerno'];
    await put(join(fixture.directory, 'manifest.json'), JSON.stringify(fixture.manifest));
    await assert.rejects(verifyPayload(fixture.directory, release, origin, 'kaordo'), /missing bin\/kerno/);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('live verification checks all applications and rejects an old Keycloak theme despite healthy services', async () => {
  const fixture = await payloadFixture();
  const requests = [];
  let staleTheme = false;
  const fetcher = async (input) => {
    const url = new URL(input);
    requests.push(url.pathname);
    const file = url.pathname === '/' ? 'site/index.html' : `site${url.pathname}index.html`;
    if (fixture.files[file]) return new Response(fixture.files[file]);
    if (url.pathname === '/silent-check-sso.html') return new Response(fixture.files['site/silent-check-sso.html']);
    if (url.pathname.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: `${origin}/realms/kaordo` });
    if (url.pathname.endsWith('/auth')) return new Response('<input name="rememberMe"><label>Stay signed in</label><script src="/resources/cache/login/kaordo/js/session.js"></script>');
    if (url.pathname.endsWith('/js/session.js')) return new Response(staleTheme ? 'old-session-script' : 'new-session-script');
    if (url.pathname.endsWith('/thread') || url.pathname === '/v1/lingvo/dictionaries') return new Response(null, { status: 401 });
    if (url.pathname === '/healthz') return new Response(null, { status: 204 });
    return new Response('healthy');
  };
  try {
    await verifyLiveRelease(fixture.directory, fixture.manifest, { ...fixture, fetcher });
    for (const path of ['/', '/fluo/', '/ligo/', '/rondo/', '/lingvo/', '/memoro/', '/regado/']) assert.ok(requests.includes(path));
    staleTheme = true;
    await assert.rejects(verifyLiveRelease(fixture.directory, fixture.manifest, { ...fixture, fetcher }), /Keycloak theme differs/);
    await put(join(fixture.dataRoot, 'bin/nodo'), 'old-nodo');
    await assert.rejects(verifyLiveRelease(fixture.directory, fixture.manifest, { ...fixture, fetcher }), /Installed release differs.*bin\/nodo/);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('source guard rejects a changed commit or changed dirty content during the build', async () => {
  const directory = await mkdtemp('/tmp/kd-source-');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '-q');
    git('config', 'user.name', 'Release fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await put(join(directory, 'source.txt'), 'original');
    git('add', '.'); git('commit', '-qm', 'fixture');
    const clean = await getSourceState(false, directory);
    await assertSourceState(clean, directory);
    await put(join(directory, 'source.txt'), 'first edit');
    const dirty = await getSourceState(true, directory);
    await put(join(directory, 'source.txt'), 'second edit');
    await assert.rejects(assertSourceState(dirty, directory), /source changed/);
    git('add', '.'); git('commit', '-qm', 'changed fixture');
    await assert.rejects(assertSourceState(clean, directory), /source changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function hostFixture(failure = '') {
  const directory = await mkdtemp('/tmp/kd-host-');
  const data = join(directory, 'data');
  const configuration = join(directory, 'config');
  const commands = join(directory, 'commands');
  const oldSystem = join(directory, 'old-system');
  const newSystem = join(directory, 'new-system');
  const systemLink = join(directory, 'current-system');
  const events = join(directory, 'events');
  const policy = join(directory, 'identity.json');
  const bundle = join(directory, 'bundle');
  const environment = { ...process.env, PATH: `${commands}:${process.env.PATH}`, FIXTURE_ROOT: directory, FIXTURE_FAIL: failure };
  await mkdir(commands);
  await mkdir(join(newSystem, 'sw/bin'), { recursive: true });
  await symlink(process.execPath, join(newSystem, 'sw/bin/node'));
  await mkdir(oldSystem);
  await symlink(oldSystem, systemLink);
  await put(policy, '{"rememberMe":false,"ssoSessionIdleTimeout":1800}');
  for (const [index, binary] of ['kerno', 'nodo', 'regado-agent'].entries()) {
    await put(join(data, 'bin', binary), `old-${binary}`);
    await put(join(directory, 'proc', String(100 + index), 'exe'), `old-${binary}`);
    await put(join(bundle, 'bin', binary), `new-${binary}`);
  }
  await put(join(configuration, 'deploy/nixos/kaordo.nix'), 'old-nix');
  await put(join(configuration, 'deploy/postgres/001.sql'), 'old-sql');
  await put(join(configuration, 'deploy/keycloak/theme'), 'old-theme');
  await put(join(configuration, 'scripts/sync-keycloak.mjs'), 'old-sync');
  await put(join(data, 'www/releases/old/index.html'), 'old-portal');
  await symlink('releases/old', join(data, 'www/current'));
  await put(join(bundle, 'site/index.html'), 'new-portal');
  await put(join(bundle, 'manifest.json'), '{}');
  await put(join(bundle, 'etc/nixos/deploy/nixos/kaordo.nix'), 'new-nix');
  await put(join(bundle, 'etc/nixos/deploy/postgres/001.sql'), 'new-sql');
  await put(join(bundle, 'etc/nixos/deploy/keycloak/theme'), 'new-theme');
  await put(join(bundle, 'etc/nixos/scripts/sync-keycloak.mjs'), 'new-sync');
  await put(join(bundle, 'RELEASE.txt'), `Source commit: ${revision}\n`);
  const identityScript = `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const base=process.env.FIXTURE_ROOT, mode=process.argv[2] || 'apply';
appendFileSync(base+'/events','identity:'+mode+'\\n');
if(mode==='--snapshot') writeFileSync(process.argv[3],readFileSync(base+'/identity.json'));
else if(mode==='--restore') writeFileSync(base+'/identity.json',readFileSync(process.argv[3]));
else writeFileSync(base+'/identity.json','{"rememberMe":true,"ssoSessionIdleTimeout":2592000}');`;
  await put(join(bundle, 'etc/nixos/deploy/nixos/sync-keycloak-production.mjs'), identityScript);
  await put(join(bundle, 'etc/nixos/deploy/nixos/verify-release.mjs'), `import{appendFileSync}from'node:fs';appendFileSync(process.env.FIXTURE_ROOT+'/events','verify:'+process.argv[2]+'\\n');if(process.env.FIXTURE_FAIL===process.argv[2])process.exit(1);`);
  await put(join(bundle, 'etc/nixos/deploy/nixos/apply-migrations.sh'), `#!/usr/bin/env bash\nprintf 'migrations\\n' >> '${events}'\n`);
  const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.FIXTURE_ROOT,args=process.argv.slice(2),name=path.basename(process.argv[1]);
fs.appendFileSync(base+'/events',name+':'+args.join(' ')+'\\n');
function link(target,file){try{fs.unlinkSync(file)}catch{}fs.symlinkSync(target,file)}
if(name==='nixos-rebuild' && args[0]==='build')link(base+'/new-system',process.cwd()+'/result');
if(name==='nixos-rebuild' && args[0]==='switch'){
  const target=args[args.indexOf('--store-path')+1];
  if(process.env.FIXTURE_FAIL==='switch' && target.endsWith('/new-system'))process.exit(1);
  link(target,base+'/current-system');
}
if(name==='switch-to-configuration')link(base+'/old-system',base+'/current-system');
if(name==='systemctl' && args[0]==='show')console.log(100+['kerno','nodo','regado-agent'].indexOf(args[1]));
if(name==='systemctl' && ['restart','start'].includes(args[0]))for(const item of args.slice(1)){let index=['kerno','nodo','regado-agent'].indexOf(item);if(index>=0)fs.copyFileSync(base+'/data/bin/'+item,base+'/proc/'+(100+index)+'/exe')}
if(name==='install')fs.copyFileSync(args[args.length-2],args[args.length-1]);
if(name==='mv')fs.renameSync(args[args.length-2],args[args.length-1]);
if(name==='sha256sum')console.log(crypto.createHash('sha256').update(fs.readFileSync(args[0])).digest('hex')+'  '+args[0]);
`;
  for (const command of ['nixos-rebuild', 'nix-env', 'systemctl', 'install', 'mv', 'sha256sum', 'curl']) {
    const path = join(commands, command); await put(path, stub); await chmod(path, 0o755);
  }
  await put(join(oldSystem, 'bin/switch-to-configuration'), stub);
  await chmod(join(oldSystem, 'bin/switch-to-configuration'), 0o755);
  const socket = createServer();
  const socketPath = join(directory, 'agent.sock');
  await new Promise((resolveSocket, reject) => { socket.once('error', reject); socket.listen(socketPath, resolveSocket); });
  let script = await readFile(join(root, 'deploy/nixos/deploy-release.sh'), 'utf8');
  script = script.replaceAll('/srv/kaordo', data).replaceAll('/etc/nixos', configuration)
    .replaceAll('/run/current-system', systemLink).replaceAll('/run/regado-agent/agent.sock', socketPath)
    .replaceAll('/proc/', `${directory}/proc/`).replaceAll('/tmp/kaordo-', `${directory}/kaordo-`);
  // Source payload paths stay relative to the release even when host paths are redirected.
  script = script.replaceAll(`$release_root${configuration}`, '$release_root/etc/nixos');
  const scriptPath = join(directory, 'deploy.sh'); await put(scriptPath, script);
  const archive = join(directory, `kaordo-${release}-full.tar.gz`);
  const tar = spawnSync('tar', ['-czf', archive, '-C', bundle, '.'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const checksum = hash(await readFile(archive));
  return {
    directory, data, configuration, oldSystem, systemLink, events, policy, environment, scriptPath, archive, checksum,
    run: () => spawnSync('bash', [scriptPath, release, checksum, 'kaordo.link', 'kaordo', archive], { env: environment, encoding: 'utf8', timeout: 20_000 }),
    close: async () => { await new Promise((close) => socket.close(close)); await rm(directory, { recursive: true, force: true }); }
  };
}

test('full deployment activates one snapshot and verifies every declared service', async () => {
  const fixture = await hostFixture();
  try {
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readlink(join(fixture.data, 'www/current')), /-full\/site$/);
    assert.equal(await readFile(join(fixture.data, 'www/current/index.html'), 'utf8'), 'new-portal');
    assert.equal(JSON.parse(await readFile(fixture.policy)).rememberMe, true);
    const events = await readFile(fixture.events, 'utf8');
    for (const service of ['livekit', 'prometheus', 'prometheus-node-exporter', 'ddclient.timer']) assert.ok(events.includes(`systemctl:is-active --quiet ${service}`));
    const phases = ['verify:payload', 'identity:--snapshot', 'migrations', 'nixos-rebuild:switch', 'identity:apply', 'verify:live'];
    for (let index = 1; index < phases.length; index++) assert.ok(events.indexOf(phases[index - 1]) < events.indexOf(phases[index]), events);
  } finally { await fixture.close(); }
});

test('failed final verification restores frontend, binaries, NixOS sources and actual previous identity policy', async () => {
  const fixture = await hostFixture('live');
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Previous release restored/);
    assert.ok((await readFile(fixture.events, 'utf8')).includes('verify:live'));
    assert.equal(await readlink(join(fixture.data, 'www/current')), 'releases/old');
    assert.equal(await realpath(fixture.systemLink), await realpath(fixture.oldSystem));
    assert.equal(await readFile(join(fixture.configuration, 'deploy/nixos/kaordo.nix'), 'utf8'), 'old-nix');
    for (const binary of ['kerno', 'nodo', 'regado-agent']) assert.equal(await readFile(join(fixture.data, 'bin', binary), 'utf8'), `old-${binary}`);
    assert.deepEqual(JSON.parse(await readFile(fixture.policy)), { rememberMe: false, ssoSessionIdleTimeout: 1800 });
  } finally { await fixture.close(); }
});

test('failed payload verification leaves active applications and identity policy intact', async () => {
  const fixture = await hostFixture('payload');
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.ok((await readFile(fixture.events, 'utf8')).includes('verify:payload'));
    assert.equal(await readlink(join(fixture.data, 'www/current')), 'releases/old');
    assert.equal(await readFile(join(fixture.data, 'bin/kerno'), 'utf8'), 'old-kerno');
    assert.equal(JSON.parse(await readFile(fixture.policy)).rememberMe, false);
    assert.equal(await readFile(join(fixture.configuration, 'deploy/nixos/kaordo.nix'), 'utf8'), 'old-nix');
  } finally { await fixture.close(); }
});

test('frontend-only deployment refuses a commit that differs from the active complete release', async () => {
  const fixture = await hostFixture();
  try {
    await put(join(fixture.data, 'releases/current/RELEASE.txt'), `Source commit: ${'b'.repeat(40)}\n`);
    const script = (await readFile(join(root, 'deploy/nixos/deploy-static.sh'), 'utf8')).replaceAll('/srv/kaordo', fixture.data);
    const path = join(fixture.directory, 'static.sh'); await put(path, script);
    const result = spawnSync('bash', [path, 'v0.0.2-81f634504b64-pages-20261006T120000Z', fixture.checksum, 'kaordo.link', 'kaordo', fixture.archive, revision], {
      env: fixture.environment, encoding: 'utf8', timeout: 10_000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Run deploy:production first/);
    assert.equal(await readlink(join(fixture.data, 'www/current')), 'releases/old');
  } finally { await fixture.close(); }
});

test('failed NixOS activation reapplies the old closure even when current-system was not switched', async () => {
  const fixture = await hostFixture('switch');
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Previous release restored/);
    const events = await readFile(fixture.events, 'utf8');
    assert.ok(events.includes(`nixos-rebuild:switch --store-path ${await realpath(fixture.oldSystem)}`));
    assert.equal(await realpath(fixture.systemLink), await realpath(fixture.oldSystem));
    assert.equal(await readFile(join(fixture.data, 'bin/kerno'), 'utf8'), 'old-kerno');
  } finally { await fixture.close(); }
});
