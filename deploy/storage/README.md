# Storage

Nodo owns upload bytes, processing outputs and local metadata. Kerno owns authorized references and retirement: a file may be shared by multiple posts/messages while a live reference remains. After its last reference is removed the upload ID is retired and Nodo purges it after confirming no active references. Unreferenced uploads age out after 24 hours; unavailable reference checks preserve bytes for a later pass.

The [NixOS profile](../nixos/README.md) stores PostgreSQL, media, releases, metrics and secrets on Data1, a Btrfs RAID1 filesystem spanning two physical disks with data/metadata mirroring and periodic scrub. NisOS is a separate 64 GiB root on one disk. Regado reports filesystem profiles, scrub and SMART evidence; it does not count unavailable checks as healthy or prove individual copies byte by byte.

Local development uses the ignored `deploy/local/media` directory and Docker database volumes, without disk mirroring. [Local restic commands](../local/README.md#encrypted-local-backups) back up both databases and media and verify disposable restores. An independent destination, recoverable key copy and schedule still require operator configuration. RAID1 is not an independent backup; dumps and media are not an atomic snapshot. Product content encryption is not implemented.
