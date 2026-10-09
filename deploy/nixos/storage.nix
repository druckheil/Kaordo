# Mounts the system and Kaordo data from Btrfs subvolumes of the pool and boots from every pool disk
{ lib, ... }:

let
  pool = "/dev/disk/by-label/Data1";
  subvolume = name: {
    device = pool;
    fsType = "btrfs";
    options = [ "subvol=${name}" "compress=zstd:3" "noatime" ];
  };
  mounts = [ "/" "/nix" "/var/log" "/srv/kaordo" ];
  # regado-agent's desired state names the pool disks; every present one gets GRUB's boot code
  state = /var/lib/regado-agent/state/current.json;
  desired = if builtins.pathExists state then builtins.fromJSON (builtins.readFile state) else { pool.devices = [ ]; };
  present = builtins.filter (id: builtins.pathExists "/dev/disk/by-id/${id}") desired.pool.devices;
in
{
  boot.supportedFilesystems = [ "btrfs" ];
  boot.initrd.supportedFilesystems = [ "btrfs" ];

  fileSystems = {
    "/" = subvolume "@root";
    "/nix" = subvolume "@nix";
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
