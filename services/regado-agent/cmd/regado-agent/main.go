package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const dataRoot = "/srv/kaordo"

var services = []string{"kerno", "nodo", "keycloak", "postgresql", "caddy", "livekit", "ddclient", "prometheus", "prometheus-node-exporter", "regado-agent"}
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
	err := command.Run()
	return output.String(), err
}

type limitWriter struct {
	writer    io.Writer
	remaining int
}

func (w *limitWriter) Write(p []byte) (int, error) {
	n := len(p)
	if w.remaining > 0 {
		part := p
		if len(part) > w.remaining {
			part = part[:w.remaining]
		}
		_, _ = w.writer.Write(part)
		w.remaining -= len(part)
	}
	return n, nil
}

type disk struct {
	Name        string       `json:"name"`
	Path        string       `json:"path"`
	Label       *string      `json:"label"`
	FSType      *string      `json:"fsType"`
	Size        int64        `json:"size"`
	Type        string       `json:"type"`
	Model       *string      `json:"model"`
	Mountpoints []*string    `json:"mountpoints"`
	Children    []disk       `json:"children,omitempty"`
	Health      *smartHealth `json:"health,omitempty"`
}

type mount struct {
	Path  string `json:"path"`
	Total int64  `json:"total"`
	Used  int64  `json:"used"`
	Free  int64  `json:"free"`
}
type service struct {
	ID       string `json:"id"`
	Active   string `json:"active"`
	Substate string `json:"substate"`
	Loaded   string `json:"loaded"`
}
type mirror struct {
	DataProfile     string `json:"dataProfile"`
	MetadataProfile string `json:"metadataProfile"`
	SystemProfile   string `json:"systemProfile"`
	MirroredPercent int    `json:"mirroredPercent"`
	DeviceErrors    int64  `json:"deviceErrors"`
	DevicesOnline   int    `json:"devicesOnline"`
	Healthy         bool   `json:"healthy"`
	Scrub           string `json:"scrub"`
}

type hostInfo struct {
	CPUModel         string `json:"cpuModel"`
	LogicalCores     int    `json:"logicalCores"`
	MemoryTotalBytes int64  `json:"memoryTotalBytes"`
	UptimeSeconds    int64  `json:"uptimeSeconds"`
	Kernel           string `json:"kernel"`
}

func readHostInfo() hostInfo {
	info := hostInfo{}
	if raw, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			switch strings.TrimSpace(key) {
			case "model name":
				if info.CPUModel == "" {
					info.CPUModel = strings.TrimSpace(value)
				}
			case "processor":
				info.LogicalCores++
			}
		}
	}
	if raw, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if !strings.HasPrefix(line, "MemTotal:") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kib, _ := strconv.ParseInt(fields[1], 10, 64)
				info.MemoryTotalBytes = kib * 1024
			}
			break
		}
	}
	if raw, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(raw))
		if len(fields) > 0 {
			seconds, _ := strconv.ParseFloat(fields[0], 64)
			info.UptimeSeconds = int64(seconds)
		}
	}
	if raw, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		info.Kernel = strings.TrimSpace(string(raw))
	}
	return info
}

var profilePattern = regexp.MustCompile(`^(Data|Metadata|System), ([^:]+): total=(\d+), used=(\d+)`)
var trailingNumber = regexp.MustCompile(`(\d+)\s*$`)

func parseMirror(df, stats, scrub string, devices int) mirror {
	item := mirror{DevicesOnline: devices, Scrub: strings.TrimSpace(scrub)}
	var dataTotal, mirroredTotal int64
	for _, line := range strings.Split(df, "\n") {
		match := profilePattern.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			continue
		}
		used, _ := strconv.ParseInt(match[4], 10, 64)
		switch match[1] {
		case "Data":
			dataTotal += used
			if match[2] == "RAID1" {
				mirroredTotal += used
			}
			item.DataProfile = combineProfile(item.DataProfile, match[2])
		case "Metadata":
			item.MetadataProfile = combineProfile(item.MetadataProfile, match[2])
		case "System":
			item.SystemProfile = combineProfile(item.SystemProfile, match[2])
		}
	}
	if dataTotal > 0 {
		item.MirroredPercent = int(100 * mirroredTotal / dataTotal)
	}
	for _, line := range strings.Split(stats, "\n") {
		if match := trailingNumber.FindStringSubmatch(line); match != nil {
			count, _ := strconv.ParseInt(match[1], 10, 64)
			item.DeviceErrors += count
		}
	}
	item.Healthy = devices >= 2 && item.DataProfile == "RAID1" &&
		item.MetadataProfile == "RAID1" && item.SystemProfile == "RAID1" && item.DeviceErrors == 0
	return item
}

func combineProfile(current, next string) string {
	if current == "" || current == next {
		return next
	}
	return "mixed"
}

func diskCount(items []disk) int {
	count := 0
	for _, item := range items {
		if item.Type == "part" && item.Label != nil && *item.Label == "Data1" {
			count++
		}
		count += diskCount(item.Children)
	}
	return count
}

func statMount(path string) (mount, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return mount{}, err
	}
	total := int64(stat.Blocks) * int64(stat.Bsize)
	free := int64(stat.Bavail) * int64(stat.Bsize)
	return mount{Path: path, Total: total, Used: total - int64(stat.Bfree)*int64(stat.Bsize), Free: free}, nil
}

func snapshot(ctx context.Context, run commandRunner, health *smartMonitor) (any, error) {
	runCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	rawDisks, err := run(runCtx, "lsblk", "--json", "--bytes", "--output", "NAME,PATH,LABEL,FSTYPE,SIZE,TYPE,MODEL,MOUNTPOINTS")
	if err != nil {
		return nil, err
	}
	var disks struct {
		BlockDevices []disk `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(rawDisks), &disks); err != nil {
		return nil, err
	}
	for i := range disks.BlockDevices {
		item := &disks.BlockDevices[i]
		if item.Type == "disk" && item.Model != nil && *item.Model != "" && physicalDevice.MatchString(item.Path) {
			checked := health.read(runCtx, run, item.Path)
			item.Health = &checked
		}
	}
	dataMount, err := statMount(dataRoot)
	if err != nil {
		return nil, err
	}
	rootMount, err := statMount("/")
	if err != nil {
		return nil, err
	}
	df, err := run(runCtx, "btrfs", "filesystem", "df", "-b", dataRoot)
	if err != nil {
		return nil, err
	}
	stats, err := run(runCtx, "btrfs", "device", "stats", dataRoot)
	if err != nil {
		return nil, err
	}
	scrub, _ := run(runCtx, "btrfs", "scrub", "status", "-d", dataRoot)
	var statuses []service
	for _, id := range services {
		raw, _ := run(runCtx, "systemctl", "show", id+".service", "--property=ActiveState,SubState,LoadState", "--no-pager")
		status := service{ID: id}
		for _, line := range strings.Split(raw, "\n") {
			key, value, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			switch key {
			case "ActiveState":
				status.Active = value
			case "SubState":
				status.Substate = value
			case "LoadState":
				status.Loaded = value
			}
		}
		statuses = append(statuses, status)
	}
	hostname, _ := os.Hostname()
	return map[string]any{"hostname": hostname, "host": readHostInfo(), "disks": disks.BlockDevices,
		"mounts": []mount{rootMount, dataMount}, "mirror": parseMirror(df, stats, scrub, diskCount(disks.BlockDevices)),
		"services": statuses, "time": time.Now().UTC()}, nil
}

func validService(id string) bool {
	for _, allowed := range services {
		if id == allowed {
			return true
		}
	}
	return false
}

func logs(ctx context.Context, run commandRunner, id string) (any, error) {
	if !validService(id) {
		return nil, errors.New("unsupported service")
	}
	runCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	raw, err := run(runCtx, "journalctl", "--unit", id+".service", "--lines", "80", "--output=json", "--no-pager", "--quiet")
	if err != nil {
		return nil, err
	}
	entries := make([]map[string]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 4096), 256*1024)
	for scanner.Scan() {
		var item map[string]any
		if json.Unmarshal(scanner.Bytes(), &item) != nil {
			continue
		}
		message, _ := item["MESSAGE"].(string)
		if len(message) > 4000 {
			message = message[:4000]
		}
		timeValue, _ := item["__REALTIME_TIMESTAMP"].(string)
		priority, _ := item["PRIORITY"].(string)
		entries = append(entries, map[string]string{"time": timeValue, "priority": priority, "message": message})
	}
	return map[string]any{"service": id, "items": entries}, scanner.Err()
}

func newHandler(run commandRunner) http.Handler {
	router := http.NewServeMux()
	health := &smartMonitor{entries: make(map[string]smartHealth)}
	router.HandleFunc("GET /snapshot", func(w http.ResponseWriter, r *http.Request) {
		value, err := snapshot(r.Context(), run, health)
		respond(w, value, err)
	})
	router.HandleFunc("GET /logs", func(w http.ResponseWriter, r *http.Request) {
		value, err := logs(r.Context(), run, r.URL.Query().Get("service"))
		respond(w, value, err)
	})
	router.HandleFunc("POST /actions/{action}", func(w http.ResponseWriter, r *http.Request) {
		args, ok := actions[r.PathValue("action")]
		if !ok {
			http.Error(w, "unsupported action", http.StatusBadRequest)
			return
		}
		runCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		output, err := run(runCtx, args...)
		if len(output) > 2000 {
			output = output[:2000]
		}
		respond(w, map[string]any{"action": r.PathValue("action"), "output": output, "accepted": err == nil}, err)
	})
	return router
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

func main() {
	path := os.Getenv("REGADO_AGENT_SOCKET")
	if path == "" {
		path = "/run/regado-agent/agent.sock"
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatal(err)
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	if err := os.Chmod(path, 0660); err != nil {
		log.Fatal(err)
	}
	log.Printf("Regado agent listening on %s", path)
	server := &http.Server{Handler: newHandler(runCommand), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 35 * time.Second}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(fmt.Errorf("serve agent: %w", err))
	}
}
