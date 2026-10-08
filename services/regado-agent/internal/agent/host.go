package agent

// Reads bounded Linux CPU, memory, uptime and operating system telemetry
import (
	"os"
	"strconv"
	"strings"
)

type hostInfo struct {
	CPUModel         string `json:"cpuModel"`
	LogicalCores     int    `json:"logicalCores"`
	MemoryTotalBytes int64  `json:"memoryTotalBytes"`
	UptimeSeconds    int64  `json:"uptimeSeconds"`
	Kernel           string `json:"kernel"`
	OSName           string `json:"osName"`
	OSVersion        string `json:"osVersion"`
	BootMode         string `json:"bootMode"`
}

func readHostInfo() hostInfo {
	cpuModel, logicalCores := readCPUInfo()
	osRelease, _ := os.ReadFile("/etc/os-release")
	osName, osVersion := parseOSRelease(string(osRelease))
	return hostInfo{
		CPUModel:         cpuModel,
		LogicalCores:     logicalCores,
		MemoryTotalBytes: readMemoryTotalBytes(),
		UptimeSeconds:    readUptimeSeconds(),
		Kernel:           readKernelVersion(),
		OSName:           osName,
		OSVersion:        osVersion,
		BootMode:         hostBootMode(),
	}
}

func hostBootMode() string {
	if _, err := os.Stat("/sys/firmware/efi"); err == nil {
		return "uefi"
	}
	return "bios"
}

func readCPUInfo() (string, int) {
	raw, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return "", 0
	}

	var model string
	logicalCores := 0
	for line := range strings.SplitSeq(string(raw), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name":
			if model == "" {
				model = strings.TrimSpace(value)
			}
		case "processor":
			logicalCores++
		}
	}
	return model, logicalCores
}

func readMemoryTotalBytes() int64 {
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}

	for line := range strings.SplitSeq(string(raw), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kib, _ := strconv.ParseInt(fields[1], 10, 64)
		return kib * 1024
	}
	return 0
}

func readUptimeSeconds() int64 {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(raw))
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return int64(seconds)
}

func readKernelVersion() string {
	raw, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
