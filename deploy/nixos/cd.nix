# Isolates production builds and polls successful main checks without inbound deployment access
{ pkgs, ... }:

let
  buildRoot = "/srv/kaordo/cd-build";
  stateRoot = "/var/lib/kaordo-cd";
in
{
  users.groups.kaordo-build = { };
  users.users.kaordo-build = {
    isSystemUser = true;
    group = "kaordo-build";
    home = buildRoot;
  };

  systemd.tmpfiles.rules = [
    "d ${buildRoot} 0700 kaordo-build kaordo-build - -"
    "d ${stateRoot} 0700 root root - -"
    "d /srv/kaordo/deployment-backups 0700 root root - -"
  ];

  systemd.services."kaordo-cd-build@" = {
    description = "Build a checked Kaordo production revision";
    unitConfig.RequiresMountsFor = "/srv/kaordo";
    path = with pkgs; [ bash coreutils git nodejs_24 corepack_24 go gnutar gzip util-linux ];
    serviceConfig = {
      Type = "oneshot";
      User = "kaordo-build";
      Group = "kaordo-build";
      ExecStart = "${pkgs.bash}/bin/bash /etc/nixos/deploy/nixos/cd-build.sh %i";
      WorkingDirectory = buildRoot;
      UMask = "0077";
      TimeoutStartSec = "30min";
      # The host serves users while it builds: the build takes idle CPU and disk time, is pushed
      # to swap above 1 GiB instead of the services, and is the first process the kernel kills
      Nice = 19;
      IOSchedulingClass = "idle";
      CPUWeight = "idle";
      CPUQuota = "150%";
      MemoryHigh = "1G";
      MemoryMax = "1536M";
      OOMScoreAdjust = 1000;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      PrivateDevices = true;
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectControlGroups = true;
      ProtectProc = "invisible";
      RestrictSUIDSGID = true;
      RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
      ReadWritePaths = [ buildRoot ];
      InaccessiblePaths = [
        stateRoot "/srv/kaordo/secrets" "/srv/kaordo/postgresql"
        "/srv/kaordo/media" "/srv/kaordo/rollbacks" "/srv/kaordo/deployment-backups"
        "-/run/regado-agent" "-/run/postgresql" "-/var/lib/regado-agent"
      ];
    };
  };

  systemd.services.kaordo-cd = {
    description = "Select successful Kaordo main revisions for deployment";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.RequiresMountsFor = "/srv/kaordo";
    # Activation belongs to a separate transient unit and survives reconciliation of this poller
    restartIfChanged = false;
    stopIfChanged = false;
    path = with pkgs; [ bash coreutils git gnutar gzip systemd util-linux postgresql_18 btrfs-progs restic ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.nodejs_24}/bin/node /etc/nixos/deploy/nixos/cd.mjs poll";
      StateDirectory = "kaordo-cd";
      StateDirectoryMode = "0700";
      UMask = "0077";
      TimeoutStartSec = "35min";
      ProtectHome = true;
      PrivateTmp = true;
    };
  };

  systemd.timers.kaordo-cd = {
    description = "Check for a deployable Kaordo main revision";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "1min";
      OnUnitInactiveSec = "1min";
      RandomizedDelaySec = "10s";
      Unit = "kaordo-cd.service";
    };
  };
}
