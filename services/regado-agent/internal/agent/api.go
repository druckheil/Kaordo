// Package agent implements the Regado agent's host telemetry, journal and service operations.
package agent

// Defines HTTP routes, allowlisted actions and journal parsing
import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// NewHandler serves host telemetry, service journals, allowlisted restarts and journal
// retention; stateDir holds the retention policy that journald reads through a symlink.
func NewHandler(stateDir string) http.Handler {
	return newHandler(runCommand, filepath.Join(stateDir, "journald-retention.conf"))
}

func newHandler(run commandRunner, policy string) http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /snapshot", func(w http.ResponseWriter, r *http.Request) {
		respond(w, snapshot(r.Context(), run), nil)
	})
	router.HandleFunc("GET /logs", logsHandler(run, policy))
	router.HandleFunc("POST /actions/{action}", actionHandler(run))
	router.HandleFunc("PATCH /logs/retention", journalRetentionHandler(run, policy))
	return router
}

func logsHandler(run commandRunner, policy string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := logs(r.Context(), run, r.URL.Query().Get("service"), policy)
		respond(w, value, err)
	}
}

func actionHandler(run commandRunner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("action")
		args, ok := actions[name]
		if !ok {
			http.Error(w, "unsupported action", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		var output string
		var err error
		if name == "restart-ddclient" {
			output, err = updateDNS(ctx, run)
		} else {
			output, err = run(ctx, args...)
		}
		if len(output) > 2000 {
			output = output[:2000]
		}
		respond(w, map[string]any{"action": name, "output": output, "accepted": err == nil}, err)
	}
}

func validService(id string) bool {
	return slices.Contains(services, id)
}

func logs(ctx context.Context, run commandRunner, id, policy string) (any, error) {
	if !validService(id) {
		return nil, errors.New("unsupported service")
	}

	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	raw, err := run(ctx, "journalctl", "--unit", id+".service", "--lines", "80", "--output=json", "--no-pager", "--quiet")
	if err != nil {
		return nil, err
	}
	entries, err := parseJournalEntries(raw)
	if err != nil {
		return nil, err
	}
	return map[string]any{"service": id, "items": entries, "journal": readJournalStatus(ctx, run, journalPolicyLink, policy)}, nil
}

func parseJournalEntries(raw string) ([]map[string]string, error) {
	entries := make([]map[string]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 4096), 256*1024)
	for scanner.Scan() {
		entry, ok := parseJournalEntry(scanner.Bytes())
		if ok {
			entries = append(entries, entry)
		}
	}
	return entries, scanner.Err()
}

func parseJournalEntry(raw []byte) (map[string]string, bool) {
	var item map[string]any
	if json.Unmarshal(raw, &item) != nil {
		return nil, false
	}

	message, _ := item["MESSAGE"].(string)
	if len(message) > 4000 {
		message = message[:4000]
	}
	timeValue, _ := item["__REALTIME_TIMESTAMP"].(string)
	priority, _ := item["PRIORITY"].(string)
	return map[string]string{"time": timeValue, "priority": priority, "message": message}, true
}

func respond(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		slog.Error("agent request failed", "err", err)
		http.Error(w, "system operation failed", http.StatusBadGateway)
		return
	}
	_ = json.NewEncoder(w).Encode(value)
}
