# Observability

The NixOS module runs Prometheus and Node Exporter on loopback, with Prometheus history on Data1. Regado requests bounded history through Kerno and renders it using uPlot; no browser receives direct Prometheus credentials or network access.

The root Regado agent supplies fixed disk/Btrfs/SMART queries and service journals over a group-protected Unix socket. SMART results are cached for five minutes and standby disks are not intentionally awakened. Logs can be filtered by allowlisted service, priority and text and downloaded as JSON. Fixed maintenance actions require an administrator audit reason.

Grafana, Loki and Cockpit are not installed by this profile. The local Docker stack does not start Prometheus or the Linux agent: corresponding views report unavailable data. See [Regado](../../apps/regado/README.md), [the agent](../../services/regado-agent/README.md) and [NixOS operations](../nixos/README.md).
