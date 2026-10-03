package main

// Parses Btrfs profiles and device statistics into mirror health
import (
	"regexp"
	"strconv"
	"strings"
)

var profilePattern = regexp.MustCompile(`^(Data|Metadata|System), ([^:]+): total=(\d+), used=(\d+)`)
var trailingNumber = regexp.MustCompile(`(\d+)\s*$`)

func parseMirror(df, stats, scrub string, devices int) mirror {
	item := mirror{DevicesOnline: devices, Scrub: strings.TrimSpace(scrub)}
	dataTotal, mirroredTotal := parseFilesystemProfiles(df, &item)
	if dataTotal > 0 {
		item.MirroredPercent = int(100 * mirroredTotal / dataTotal)
	}
	item.DeviceErrors = parseDeviceErrors(stats)
	item.Healthy = devices >= 2 && item.DataProfile == "RAID1" &&
		item.MetadataProfile == "RAID1" && item.SystemProfile == "RAID1" && item.DeviceErrors == 0
	return item
}

func parseFilesystemProfiles(output string, item *mirror) (dataTotal, mirroredTotal int64) {
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
