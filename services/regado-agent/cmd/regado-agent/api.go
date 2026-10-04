package main

// Defines HTTP routes, allowlisted actions, mount validation, and journal parsing
import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

func newHandler(run commandRunner, replication *replicationMonitor) http.Handler {
	router := http.NewServeMux()
	health := &smartMonitor{entries: make(map[string]smartHealth)}
	router.HandleFunc("GET /snapshot", snapshotHandler(run, health, replication))
	router.HandleFunc("GET /logs", logsHandler(run))
	router.HandleFunc("POST /actions/{action}", actionHandler(run, replication))
	router.HandleFunc("POST /storage/plan", layoutHandler(run, replication, false))
	router.HandleFunc("POST /storage/apply", layoutHandler(run, replication, true))
	router.HandleFunc("PATCH /logs/retention", journalRetentionHandler(run))
	return router
}

func snapshotHandler(run commandRunner, health *smartMonitor, replication *replicationMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := snapshot(r.Context(), run, health)
		if err == nil {
			value["replicationReports"] = replication.status()
			value["layoutReports"] = replication.layoutStatus()
		}
		respond(w, value, err)
	}
}

func logsHandler(run commandRunner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := logs(r.Context(), run, r.URL.Query().Get("service"))
		respond(w, value, err)
	}
}

func actionHandler(run commandRunner, replication *replicationMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("action")
		request, err := decodeActionRequest(w, r)
		if err != nil {
			http.Error(w, "invalid action request", http.StatusBadRequest)
			return
		}
		args, ok := actions[name]
		if !ok && name != "scrub-filesystem" && name != "configure-storage" && name != "check-storage" && name != "repair-storage" {
			http.Error(w, "unsupported action", http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		var output string
		switch name {
		case "check-storage", "repair-storage":
			if request.Identity != "" || request.Filesystem != "" {
				http.Error(w, "unsupported storage-check fields", http.StatusBadRequest)
				return
			}
			err = replication.start(ctx, run, request.Target, name == "repair-storage")
			output = "Storage check started. Progress appears in File copies."
			if name == "repair-storage" {
				output = "Storage repair started. Progress appears in File copies."
			}
		case "scrub-filesystem":
			if request.Identity != "" || request.Filesystem != "" {
				http.Error(w, "identity and filesystem are not supported for this action", http.StatusBadRequest)
				return
			}
			output, err = startFilesystemScrub(ctx, run, request.Target)
		case "configure-storage":
			var desired layoutRequest
			desired, err = legacyStorageLayout(ctx, run, storageActionRequest{
				Target: request.Target, Identity: request.Identity, Filesystem: request.Filesystem,
			})
			if err == nil {
				var plan storagePlan
				plan, err = previewStoragePlan(ctx, run, desired)
				if err == nil {
					desired.Fingerprint, desired.Confirmation = plan.Fingerprint, desired.Device
					err = replication.startLayout(ctx, run, desired)
					output = "Disko setup queued. Progress appears on the device card."
				}
			}

		default:
			if request.Target != "" || request.Identity != "" || request.Filesystem != "" {
				http.Error(w, "target is not supported for this action", http.StatusBadRequest)
				return
			}
			if name == "restart-ddclient" {
				output, err = updateDNS(ctx, run)
			} else {
				output, err = run(ctx, args...)
			}
		}
		if len(output) > 2000 {
			output = output[:2000]
		}
		respond(w, map[string]any{"action": name, "target": request.Target, "output": output, "accepted": err == nil}, err)
	}
}

type actionRequest struct {
	Target     string `json:"target"`
	Identity   string `json:"identity"`
	Filesystem string `json:"filesystem"`
}

func decodeActionRequest(w http.ResponseWriter, r *http.Request) (actionRequest, error) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	decoder.DisallowUnknownFields()
	var request actionRequest
	if err := decoder.Decode(&request); err != nil {
		return actionRequest{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return actionRequest{}, errors.New("unexpected action request data")
	}
	return request, nil
}

func startFilesystemScrub(ctx context.Context, run commandRunner, target string) (string, error) {
	if len(target) > 1024 || !filepath.IsAbs(target) || filepath.Clean(target) != target {
		return "", errors.New("filesystem target must be a clean absolute mount path")
	}
	raw, err := run(ctx, "findmnt", "--json", "--list", "--output", "TARGET,FSTYPE")
	if err != nil {
		return "", err
	}
	if !isMountedBtrfs(raw, target) {
		return "", errors.New("filesystem target is not a mounted Btrfs filesystem")
	}
	return run(ctx, "btrfs", "scrub", "start", target)
}

func isMountedBtrfs(raw, target string) bool {
	var result struct {
		Filesystems []struct {
			Target string `json:"target"`
			FSType string `json:"fstype"`
		} `json:"filesystems"`
	}
	if json.Unmarshal([]byte(raw), &result) != nil {
		return false
	}
	for _, filesystem := range result.Filesystems {
		if filesystem.Target == target && filesystem.FSType == "btrfs" {
			return true
		}
	}
	return false
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
	return map[string]any{"service": id, "items": entries, "journal": readJournalStatus(ctx, run)}, nil
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
