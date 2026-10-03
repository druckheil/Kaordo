# Regado agent

Independent Linux system monitor and restricted maintenance service. Build with
`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./cmd/regado-agent`.

The agent runs as root and accepts local HTTP over the group-protected Unix
socket `/run/regado-agent/agent.sock`. Kerno checks the current database admin
role and writes an audit record before requesting privileged actions. The
agent has no TCP listener and never executes caller-supplied commands.

Queries use lsblk, Btrfs, smartmontools and systemd's journal. SMART JSON is
cached for five minutes; low-power devices return a standby status. Only
fixed restart actions for Nodo, LiveKit and ddclient and a Data1 scrub are
supported. The NixOS module supplies executable paths and process isolation.
