package agent

// Defines permitted system actions and the shared subprocess runner
import "github.com/druckheil/Kaordo/services/regado-agent/internal/command"

var services = []string{
	"kerno",
	"nodo",
	"keycloak",
	"postgresql",
	"caddy",
	"livekit",
	"ddclient",
	"prometheus",
	"prometheus-node-exporter",
	"regado-agent",
}

var actions = map[string][]string{
	"restart-nodo":     {"systemctl", "restart", "nodo.service"},
	"restart-livekit":  {"systemctl", "restart", "livekit.service"},
	"restart-ddclient": {"systemctl", "start", "ddclient.service"},
}

type commandRunner = command.Runner

var runCommand command.Runner = command.Run
