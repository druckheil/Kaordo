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

## Code organization

`main.go` loads configuration and owns the Unix listener/server. `api.go` defines fixed routes, service allowlists and handlers; `command.go` bounds subprocess output and execution; `snapshot.go` reads host usage; `mirror.go` reads Btrfs profiles/scrub; `smart.go` parses and caches device health without treating missing evidence as healthy. Filename-purpose comments appear before imports.

From the repository root run `go test -race ./services/regado-agent/...` and `go build ./services/regado-agent/...`. Linux commands require the NixOS profile; unit tests inject command responses and cover parsing/failures. See [refactor evidence](../../docs/refactoring.md).
