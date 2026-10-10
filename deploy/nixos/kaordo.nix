# Runs the production Kaordo services and mounts their persistent data
{ config, lib, pkgs, ... }:

let
  dataRoot = "/srv/kaordo";
  origin = "https://kaordo.link";
  loginTheme = pkgs.runCommand "kaordo-keycloak-theme" { } ''
    mkdir -p "$out"
    cp -R ${../keycloak/themes/kaordo}/* "$out/"
  '';
in
{
  # The system and data live in subvolumes of the pool; the host's own configuration may import it too
  imports = [ ./storage.nix ];

  zramSwap.enable = true;
  zramSwap.memoryPercent = 100;

  networking.hosts."127.0.0.1" = [ "kaordo.link" ];
  networking.firewall.allowedTCPPorts = [ 80 443 7881 ];
  networking.firewall.allowedUDPPorts = [ 3478 7882 ];

  users.groups.kaordo = { };
  users.groups.regado-agent = { };
  users.users.kaordo = {
    isSystemUser = true;
    group = "kaordo";
  };

  systemd.tmpfiles.rules = [
    "d /var/lib/regado-agent 0700 root regado-agent - -"
    "C /var/lib/regado-agent/journald-retention.conf 0600 root root - ${pkgs.writeText "kaordo-journal-retention-default.conf" "[Journal]\nMaxRetentionSec=14day\n"}"
    "d /var/lib/btrfs 0755 root root - -"
    "d ${dataRoot}/postgresql 0700 postgres postgres - -"
    "d ${dataRoot}/media 0700 kaordo kaordo - -"
    "d ${dataRoot}/secrets 0700 root root - -"
    "d ${dataRoot}/caddy 0700 caddy caddy - -"
    "d ${dataRoot}/prometheus 0700 prometheus prometheus - -"
  ];

  services.journald.extraConfig = ''
    SystemMaxUse=256M
    SystemMaxFileSize=16M
    MaxRetentionSec=14day
  '';
  # The immutable host integration points to a persistent, narrowly managed retention override
  environment.etc."systemd/journald.conf.d/90-kaordo-retention.conf".source =
    "/var/lib/regado-agent/journald-retention.conf";

  services.prometheus = {
    enable = true;
    listenAddress = "127.0.0.1";
    retentionTime = "7d";
    globalConfig.scrape_interval = "15s";
    exporters.node = {
      enable = true;
      listenAddress = "127.0.0.1";
    };
    scrapeConfigs = [{
      job_name = "nixos";
      static_configs = [{ targets = [ "127.0.0.1:9100" ]; }];
    }];
  };

  systemd.services.prometheus = {
    unitConfig.RequiresMountsFor = dataRoot;
    serviceConfig.BindPaths = [ "${dataRoot}/prometheus:/var/lib/prometheus2" ];
  };

  systemd.services.regado-agent = {
    description = "Kaordo local system monitor and restricted control agent";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" ];
    unitConfig.RequiresMountsFor = dataRoot;
    path = [ pkgs.util-linux pkgs.btrfs-progs pkgs.gptfdisk pkgs.dosfstools pkgs.systemd pkgs.smartmontools pkgs.grub2 ];
    serviceConfig = {
      User = "root";
      Group = "regado-agent";
      ExecStart = "${dataRoot}/bin/regado-agent";
      Restart = "on-failure";
      RestartSec = 5;
      RuntimeDirectory = "regado-agent";
      RuntimeDirectoryMode = "0750";
      StateDirectory = "regado-agent";
      StateDirectoryMode = "0700";
      NoNewPrivileges = true;
      PrivateNetwork = true;
      # The agent measures /tmp, /home and /root; it reads them and writes none
      ProtectHome = "read-only";
      ProtectSystem = "strict";
      ReadWritePaths = [ dataRoot "/run/regado-agent" "/var/lib/btrfs" "/var/lib/regado-agent" "-/boot" "-/var/log/journal" "-/run/log/journal" ];
      RestrictAddressFamilies = [ "AF_UNIX" ];
    };
  };

  environment.systemPackages = with pkgs; [ btrfs-progs e2fsprogs gptfdisk nodejs restic rsync smartmontools ];

  services.postgresql = {
    enable = true;
    package = pkgs.postgresql_18;
    dataDir = "${dataRoot}/postgresql";
    enableTCPIP = true;
    initdbArgs = [ "--data-checksums" ];
    ensureDatabases = [ "kaordo" ];
    ensureUsers = [ { name = "kaordo"; ensureDBOwnership = true; } ];
    authentication = lib.mkForce ''
      local all all peer
      host all all 127.0.0.1/32 scram-sha-256
      host all all ::1/128 scram-sha-256
    '';
    settings = {
      listen_addresses = lib.mkForce "127.0.0.1";
      password_encryption = "scram-sha-256";
      shared_buffers = "128MB";
      max_connections = 50;
      standard_conforming_strings = true;
    };
  };
  services.keycloak = {
    enable = true;
    database.passwordFile = "${dataRoot}/secrets/keycloak-db-password";
    realmFiles = [ ./kaordo-realm.json ];
    themes.kaordo = loginTheme;
    settings = {
      hostname = origin;
      http-enabled = true;
      http-host = "127.0.0.1";
      http-port = 8080;
      proxy-headers = "xforwarded";
      health-enabled = true;
    };
  };
  systemd.services.keycloak = {
    unitConfig.RequiresMountsFor = dataRoot;
    preStart = ''
      mkdir -p /run/keycloak/data/import
      ln -sfn ${./kaordo-realm.json} /run/keycloak/data/import/kaordo-realm.json
    '';
    environment = {
      KAORDO_SITE_ORIGIN = origin;
      JAVA_OPTS_APPEND = "-Xms128m -Xmx512m";
    };
    serviceConfig.EnvironmentFile = "-${dataRoot}/secrets/keycloak-admin.env";
  };
  systemd.services.keycloakPostgreSQLInit.unitConfig.RequiresMountsFor = dataRoot;

  services.livekit = {
    enable = true;
    keyFile = "${dataRoot}/secrets/livekit-keys";
    settings = {
      port = 7880;
      rtc = {
        tcp_port = 7881;
        udp_port = 7882;
        use_external_ip = true;
      };
      turn = {
        enabled = true;
        udp_port = 3478;
      };
    };
  };
  systemd.services.livekit.unitConfig.RequiresMountsFor = dataRoot;

  systemd.services.nodo = {
    description = "Kaordo media service";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.RequiresMountsFor = dataRoot;
    serviceConfig = {
      User = "kaordo";
      Group = "kaordo";
      ExecStart = "${dataRoot}/bin/nodo";
      EnvironmentFile = "${dataRoot}/secrets/nodo.env";
      Restart = "on-failure";
      RestartSec = 5;
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
      ReadWritePaths = [ "${dataRoot}/media" ];
    };
  };

  systemd.services.kerno = {
    description = "Kaordo API service";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" "postgresql.service" "keycloak.service" "nodo.service" "regado-agent.service" ];
    wants = [ "network-online.target" ];
    requires = [ "postgresql.service" "keycloak.service" "nodo.service" ];
    unitConfig.RequiresMountsFor = dataRoot;
    serviceConfig = {
      User = "kaordo";
      Group = "kaordo";
      SupplementaryGroups = [ "regado-agent" ];
      ExecStart = "${dataRoot}/bin/kerno";
      EnvironmentFile = "${dataRoot}/secrets/kerno.env";
      Restart = "on-failure";
      RestartSec = 5;
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
    };
  };

  services.caddy = {
    enable = true;
    dataDir = "${dataRoot}/caddy";
    virtualHosts."kaordo.link".extraConfig = ''
      encode zstd gzip
      route {
        @nodo path /v1/uploads* /v1/media*
        handle @nodo {
          reverse_proxy 127.0.0.1:8082
        }
        @kerno path /v1/*
        handle @kerno {
          reverse_proxy 127.0.0.1:8081
        }
        @admin path /admin /admin/*
        handle @admin {
          respond 404
        }
        @identity path /realms/* /resources/*
        handle @identity {
          reverse_proxy 127.0.0.1:8080
        }
        @rtc path /rtc*
        handle @rtc {
          reverse_proxy 127.0.0.1:7880
        }
        handle {
          root * ${dataRoot}/www/current
          try_files {path} {path}/ /index.html
          file_server
        }
      }
    '';
  };
  systemd.services.caddy.unitConfig.RequiresMountsFor = dataRoot;

  services.ddclient = {
    enable = true;
    protocol = "namecheap";
    server = "dynamicdns.park-your-domain.com";
    username = "kaordo.link";
    domains = [ "@" ];
    passwordFile = "${dataRoot}/secrets/namecheap-ddns";
    interval = "1min";
    extraConfig = "min-interval=1m";
  };
  systemd.services.ddclient.unitConfig.RequiresMountsFor = dataRoot;
}
