# Installs the releases GitHub Actions builds when Kerno relays a trusted run's request
{ config, pkgs, ... }:

let
  # The only workflow whose push runs may deploy, as GitHub writes its OIDC workflow_ref claim
  workflow = "druckheil/Kaordo/.github/workflows/checks.yml@refs/heads/main";
in
{
  systemd.services.kerno.environment.KAORDO_DEPLOY_WORKFLOW = workflow;

  # The agent starts one instance per run; /srv/kaordo/secrets/github-actions-token reads artifacts
  systemd.services."kaordo-deploy@" = {
    description = "Install the Kaordo release built by GitHub Actions run %i";
    unitConfig.RequiresMountsFor = "/srv/kaordo";
    # A deployment switches the system it runs on; that switch must not restart or stop it
    restartIfChanged = false;
    stopIfChanged = false;
    # deploy-release.sh runs as in an operator's shell: the system's tools, and the NIX_PATH that
    # nixos-rebuild needs to find <nixpkgs/nixos> and the host configuration
    path = [ "/run/current-system/sw" pkgs.unzip ];
    environment = {
      inherit (config.environment.sessionVariables) NIX_PATH;
      HOME = "/root";
      KAORDO_DEPLOY_WORKFLOW = workflow;
    };
    serviceConfig = {
      Type = "exec";
      # Runs queue behind each other; one whose revision is no longer the branch head is superseded
      ExecStart = "${pkgs.util-linux}/bin/flock /run/kaordo-deploy.lock ${pkgs.nodejs_24}/bin/node /etc/nixos/deploy/nixos/deploy.mjs %i";
      RuntimeMaxSec = "25min";
      TimeoutStopSec = "5min";
      LoadCredential = "github-token:/srv/kaordo/secrets/github-actions-token";
      StateDirectory = "kaordo-deploy";
      StateDirectoryMode = "0700";
      PrivateTmp = true;
      UMask = "0077";
    };
  };
}
