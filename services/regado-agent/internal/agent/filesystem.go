package agent

// Parses Btrfs filesystem profiles, device errors, and scrub status
import (
	"regexp"
	"strconv"
	"strings"
)

var profilePattern = regexp.MustCompile(`^(Data|Metadata|System), ([^:]+): total=(\d+), used=(\d+)`)
var trailingNumber = regexp.MustCompile(`(\d+)\s*$`)
var totalDevicePattern = regexp.MustCompile(`(?m)^\s*Total devices\s+(\d+)\b`)
var filesystemUUIDPattern = regexp.MustCompile(`(?m)^Label:.*\buuid:\s*([0-9a-fA-F-]+)\s*$`)
var filesystemMemberPattern = regexp.MustCompile(`(?m)^\s*devid\s+\d+.*\bpath\s+(.+?)\s*$`)
var scrubStatusPattern = regexp.MustCompile(`(?mi)^\s*Status:\s*(\w+)`)
var scrubErrorPattern = regexp.MustCompile(`(?mi)^\s*Error summary:\s*([^\r\n]*)$`)
var scrubNumberPattern = regexp.MustCompile(`\b(?:read|write|flush|corruption|generation|csum|verify)=(\d+)`)

func parseFilesystemIntegrity(df, stats, scrub, devices, balance string, devicesOnline, devicesExpected int) filesystemIntegrity {
	item := filesystemIntegrity{
		UUID:            parseFilesystemUUID(devices),
		Members:         parseFilesystemMembers(devices),
		DevicesOnline:   devicesOnline,
		DevicesExpected: devicesExpected,
		BalanceRunning:  isBalanceRunning(balance),
		ScrubState:      parseScrubState(scrub),
		ScrubErrors:     parseScrubErrors(scrub),
	}
	dataTotal, mirroredTotal := parseFilesystemProfiles(df, &item)
	if dataTotal > 0 {
		item.MirroredPercent = int(100 * mirroredTotal / dataTotal)
	}
	item.DeviceErrors = parseDeviceErrors(stats)
	item.Healthy = devicesExpected > 0 && devicesOnline == devicesExpected && item.DataProfile == "RAID1" &&
		item.MetadataProfile == "RAID1" && item.SystemProfile == "RAID1" && item.MirroredPercent == 100 && item.DeviceErrors == 0
	return item
}

func parseFilesystemUUID(output string) string {
	match := filesystemUUIDPattern.FindStringSubmatch(output)
	if len(match) < 2 {
		return ""
	}
	return strings.ToLower(match[1])
}

func parseFilesystemMembers(output string) []string {
	matches := filesystemMemberPattern.FindAllStringSubmatch(output, -1)
	result := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) > 1 {
			path := strings.TrimSpace(match[1])
			if path != "" {
				result = append(result, path)
			}
		}
	}
	return result
}

func isBalanceRunning(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "balance") &&
		(strings.Contains(lower, " is running") || strings.Contains(lower, " is paused"))
}

func parseScrubState(output string) string {
	lower := strings.ToLower(output)
	if strings.Contains(lower, "no scrub running") || strings.Contains(lower, "no scrub found") {
		return "not-run"
	}
	states := scrubStatusPattern.FindAllStringSubmatch(lower, -1)
	complete := len(states) > 0
	for _, state := range states {
		if state[1] == "running" {
			return "running"
		}
		complete = complete && state[1] == "finished"
	}
	if !complete {
		return "unknown"
	}
	if parseScrubErrors(output) > 0 {
		return "errors"
	}
	return "complete"
}

func parseScrubErrors(output string) int64 {
	var total int64
	for _, match := range scrubErrorPattern.FindAllStringSubmatch(output, -1) {
		summary := strings.ToLower(strings.TrimSpace(match[1]))
		if strings.Contains(summary, "no errors") {
			continue
		}
		counts := scrubNumberPattern.FindAllStringSubmatch(summary, -1)
		for _, countMatch := range counts {
			count, _ := strconv.ParseInt(countMatch[1], 10, 64)
			total += count
		}
		if len(counts) == 0 && summary != "" {
			total++
		}
	}
	return total
}

func parseFilesystemDeviceCounts(output string) (online, expected int) {
	for line := range strings.SplitSeq(output, "\n") {
		line = strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(line, "devid ") && !strings.Contains(line, "path missing") {
			online++
		}
	}
	match := totalDevicePattern.FindStringSubmatch(output)
	if len(match) > 1 {
		expected, _ = strconv.Atoi(match[1])
	}
	return online, expected
}

func parseFilesystemProfiles(output string, item *filesystemIntegrity) (dataTotal, mirroredTotal int64) {
	for line := range strings.SplitSeq(output, "\n") {
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
	return dataTotal, mirroredTotal
}

func parseDeviceErrors(stats string) int64 {
	var total int64
	for line := range strings.SplitSeq(stats, "\n") {
		match := trailingNumber.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		count, _ := strconv.ParseInt(match[1], 10, 64)
		total += count
	}
	return total
}

func combineProfile(current, next string) string {
	if current == "" || current == next {
		return next
	}
	return "mixed"
}
