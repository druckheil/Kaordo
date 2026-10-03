package main

// Defines permitted system actions and the bounded subprocess runner
import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
)

const dataRoot = "/srv/kaordo"

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
	"restart-ddclient": {"systemctl", "restart", "ddclient.service"},
	"scrub-data":       {"btrfs", "scrub", "start", dataRoot},
}

type commandRunner func(context.Context, ...string) (string, error)

func runCommand(ctx context.Context, args ...string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("missing command")
	}

	command := exec.CommandContext(ctx, args[0], args[1:]...)
	var output bytes.Buffer
	command.Stdout = &limitWriter{writer: &output, remaining: 1 << 20}
	command.Stderr = &limitWriter{writer: &output, remaining: 1 << 20}
	if err := command.Run(); err != nil {
		return output.String(), err
	}
	return output.String(), nil
}

type limitWriter struct {
	writer    io.Writer
	remaining int
}

func (writer *limitWriter) Write(p []byte) (int, error) {
	length := len(p)
	if writer.remaining <= 0 {
		return length, nil
	}

	part := p
	if len(part) > writer.remaining {
		part = part[:writer.remaining]
	}
	_, _ = writer.writer.Write(part)
	writer.remaining -= len(part)
	return length, nil
}
