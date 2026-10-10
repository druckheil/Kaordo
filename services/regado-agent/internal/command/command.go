// Package command runs fixed host tools with bounded output.
package command

// Defines the runner signature that operations accept, so tests can replace host tools
import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const outputLimit = 1 << 20

// Runner executes a fixed binary with arguments and returns combined output.
type Runner func(ctx context.Context, args ...string) (string, error)

// Run executes the command and keeps at most 1 MiB of combined output.
func Run(ctx context.Context, args ...string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("missing command")
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...) //nolint:gosec // callers pass fixed binaries and validated device paths
	var output bytes.Buffer
	writer := &limitWriter{writer: &output, remaining: outputLimit}
	cmd.Stdout, cmd.Stderr = writer, writer
	if err := cmd.Run(); err != nil {
		return output.String(), fmt.Errorf("%s: %w: %s", args[0], err, lastLine(output.String()))
	}
	return output.String(), nil
}

func lastLine(output string) string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

type limitWriter struct {
	mu        sync.Mutex
	writer    io.Writer
	remaining int
}

func (writer *limitWriter) Write(p []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	length := len(p)
	if writer.remaining <= 0 {
		return length, nil
	}
	part := p[:min(len(p), writer.remaining)]
	_, _ = writer.writer.Write(part)
	writer.remaining -= len(part)
	return length, nil
}

// Track runs a blocking tool while calling progress every poll. When ctx ends, stop asks the
// tool to finish early and Track still waits for it, so the tool never outlives its caller.
func Track(ctx context.Context, run Runner, args []string, poll time.Duration, progress, stop func()) error {
	result := make(chan error, 1)
	go func() {
		_, err := run(context.WithoutCancel(ctx), args...)
		result <- err
	}()
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	cancelled := ctx.Done()
	stopped := false
	for {
		select {
		case err := <-result:
			if err != nil && stopped {
				return ctx.Err()
			}
			return err
		case <-ticker.C:
			progress()
		case <-cancelled:
			cancelled = nil
			if stop != nil {
				stopped = true
				stop()
			}
		}
	}
}
