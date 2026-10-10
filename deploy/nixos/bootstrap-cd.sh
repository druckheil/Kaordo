#!/usr/bin/env bash
# Installs the pull controller while preserving the active applications and existing main baseline
set -euo pipefail
umask 077

[[ "$EUID" -eq 0 ]] || { echo 'CD bootstrap requires root' >&2; exit 1; }
source_root=$(cd "$(dirname "$0")" && pwd)
state_root=/var/lib/kaordo-cd
configuration=/etc/nixos/configuration.nix
previous_system=$(readlink -f /run/current-system)
mkdir -p "$state_root" /etc/nixos/deploy/nixos
chmod 0700 "$state_root"
[[ ! -e "$state_root/state.json" ]] || { echo 'CD is already bootstrapped; update it through main' >&2; exit 1; }
cp -a "$configuration" "$state_root/bootstrap-configuration.nix"

restore_bootstrap() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    cp -a "$state_root/bootstrap-configuration.nix" "$configuration"
    nixos-rebuild switch --store-path "$previous_system" || echo 'CD bootstrap rollback needs operator attention' >&2
    rm -f "$state_root/state.json"
  fi
  exit "$status"
}
trap restore_bootstrap EXIT

for file in cd.nix cd-build.sh cd.mjs checkpoint.mjs; do
  install -o root -g root -m 0644 "$source_root/$file" "/etc/nixos/deploy/nixos/$file"
done
cat >/etc/nixos/kaordo-cd-bootstrap.nix <<'NIX'
# Keeps the commissioned CD module available across application rollback
{ ... }: { imports = [ ./deploy/nixos/cd.nix ]; }
NIX
node --input-type=module - "$configuration" "$state_root/state.json" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const [configuration,state] = process.argv.slice(2);
const source = readFileSync(configuration,'utf8');
if (!/imports\s*=\s*\[/.test(source)) throw new Error('Expected an imports list in host configuration.');
if (!source.includes('./kaordo-cd-bootstrap.nix'))
  writeFileSync(configuration,source.replace(/imports\s*=\s*\[/,'imports = [ ./kaordo-cd-bootstrap.nix '));
const active = JSON.parse(readFileSync('/srv/kaordo/releases/current/manifest.json','utf8'));
const response = await fetch('https://api.github.com/repos/druckheil/Kaordo/git/ref/heads/main', {
  headers: {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},
  signal: AbortSignal.timeout(15000), redirect:'error'
});
if (!response.ok) throw new Error('Cannot record the initial main baseline.');
const baseline = await response.json();
if (baseline.ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(baseline.object?.sha) ||
    !/^[a-f0-9]{40}$/.test(active.sourceCommit) || active.workingTreeDirty !== false)
  throw new Error('CD requires clean, recorded main and production revisions.');
writeFileSync(state, JSON.stringify({baselineCommit:baseline.object.sha,activeCommit:active.sourceCommit,phase:'idle',bootstrappedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
JS
nixos-rebuild switch
systemctl enable --now kaordo-cd.timer
systemctl start kaordo-cd.service
systemctl is-active --quiet caddy keycloak postgresql livekit kerno nodo regado-agent kaordo-cd.timer
echo 'Main-only pull deployment is active; the existing main baseline was not deployed.'
