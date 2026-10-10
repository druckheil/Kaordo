# Mounts the system and Kaordo data from Btrfs subvolumes of the pool and boots from every pool disk
{ lib, ... }:

let
  pool = "/dev/disk/by-label/Data1";
  subvolume = name: {
    device = pool;
    fsType = "btrfs";
    # Btrfs keeps the mount alive when a member is replaced; systemd must not stop it with that device
    options = [ "subvol=${name}" "compress=zstd:3" "noatime" "x-systemd.device-bound=false" ];
  };
  mounts = [ "/" "/nix" "/var/log" "/srv/kaordo" ];
  # regado-agent's desired state names the pool disks; every present one gets GRUB's boot code
  state = /var/lib/regado-agent/state/current.json;
  desired = if builtins.pathExists state then builtins.fromJSON (builtins.readFile state) else { pool.devices = [ ]; };
  present = builtins.filter (id: builtins.pathExists "/dev/disk/by-id/${id}") desired.pool.devices;
in
{
  # A pool of any size boots; GRUB needs at least one of its disks to be present
  assertions = [{
    assertion = present != [ ];
    message = "No pool disk named in regado-agent's desired state is present to carry GRUB";
  }];

  boot.supportedFilesystems = [ "btrfs" ];
  boot.initrd.supportedFilesystems = [ "btrfs" ];

  fileSystems = {
    "/" = subvolume "@root";
    "/nix" = subvolume "@nix" // { neededForBoot = true; };
    "/var/log" = subvolume "@log" // { neededForBoot = true; };
    # Nested subvolumes postgresql, media, prometheus and releases appear inside @kaordo
    "/srv/kaordo" = subvolume "@kaordo";
  };

  boot.loader.grub = {
    enable = true;
    devices = lib.mkIf (present != [ ]) (map (id: "/dev/disk/by-id/${id}") present);
  };

  # Chosen at the boot menu after a pool disk failed: mounts the remaining copy until it is replaced
  specialisation.degraded.configuration.fileSystems = lib.genAttrs mounts (_: { options = [ "degraded" ]; });
}
