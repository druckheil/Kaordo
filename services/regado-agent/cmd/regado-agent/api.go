package main

// Defines HTTP routes, request handlers, and journal response parsing
import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
)

func newHandler(run commandRunner) http.Handler {
	router := http.NewServeMux()
	health := &smartMonitor{entries: make(map[string]smartHealth)}
	router.HandleFunc("GET /snapshot", snapshotHandler(run, health))
	router.HandleFunc("GET /logs", logsHandler(run))
	router.HandleFunc("POST /actions/{action}", actionHandler(run))
	return router
}

func snapshotHandler(run commandRunner, health *smartMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := snapshot(r.Context(), run, health)
		respond(w, value, err)
	}
}

func logsHandler(run commandRunner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := logs(r.Context(), run, r.URL.Query().Get("service"))
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
		output, err := run(ctx, args...)
		if len(output) > 2000 {
			output = output[:2000]
		}
		respond(w, map[string]any{"action": name, "output": output, "accepted": err == nil}, err)
	}
}

func validService(id string) bool {
	return slices.Contains(services, id)
}

func logs(ctx context.Context, run commandRunner, id string) (any, error) {
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
	return map[string]any{"service": id, "items": entries}, nil
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
		log.Printf("agent request: %v", err)
		http.Error(w, "system operation failed", http.StatusBadGateway)
		return
	}
	_ = json.NewEncoder(w).Encode(value)
}
