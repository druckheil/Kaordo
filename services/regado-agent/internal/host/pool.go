package host

// Reads Btrfs pool membership, redundancy profiles, capacity and per-device error counters
import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

type Member struct {
	DevID int64  `json:"devid"`
	Size  int64  `json:"size"`
	Used  int64  `json:"used"`
	Path  string `json:"path"`
	// DeviceID is the physical device's stable identity, resolved from the inventory.
	DeviceID string       `json:"deviceId"`
	Missing  bool         `json:"missing"`
	Errors   DeviceErrors `json:"errors"`
}

type DeviceErrors struct {
	Write      int64 `json:"write"`
	Read       int64 `json:"read"`
	Flush      int64 `json:"flush"`
	Corruption int64 `json:"corruption"`
	Generation int64 `json:"generation"`
}

// Total sums every counter; any non-zero value deserves attention.
func (errors DeviceErrors) Total() int64 {
	return errors.Write + errors.Read + errors.Flush + errors.Corruption + errors.Generation
}

type Pool struct {
	UUID    string   `json:"uuid"`
	Label   string   `json:"label"`
	Mount   string   `json:"mount"`
	Members []Member `json:"members"`
	// Profiles lists every block-group profile per type; more than one means a conversion is pending.
	DataProfiles     []string `json:"dataProfiles"`
	MetadataProfiles []string `json:"metadataProfiles"`
	SystemProfiles   []string `json:"systemProfiles"`
	DeviceSize       int64    `json:"deviceSize"`
	Allocated        int64    `json:"allocated"`
	Used             int64    `json:"used"`
	FreeEstimated    int64    `json:"freeEstimated"`
	// MetadataUsed is one copy of the filesystem's own metadata, including small files kept inline
	MetadataUsed int64   `json:"metadataUsed"`
	DataRatio    float64 `json:"dataRatio"`
}

var (
	showHeader   = regexp.MustCompile(`Label:\s+(?:'([^']*)'|none)\s+uuid:\s+([0-9a-f-]{36})`)
	showMember   = regexp.MustCompile(`^\s*devid\s+(\d+)\s+size\s+(\d+)\s+used\s+(\d+)\s+path\s+(.+?)\s*$`)
	usageValue   = regexp.MustCompile(`^\s*(Device size|Device allocated|Used|Free \(estimated\)|Data ratio):\s+([0-9.]+)`)
	usageProfile = regexp.MustCompile(`^(Data|Metadata|System),([A-Za-z0-9]+):.*Used:(\d+)`)
	statsLine    = regexp.MustCompile(`^\[(.+)\]\.(write_io_errs|read_io_errs|flush_io_errs|corruption_errs|generation_errs)\s+(\d+)`)
)

// ReadPool reads the Btrfs filesystem mounted at mount and maps members to devices.
func ReadPool(ctx context.Context, run command.Runner, mount string, devices []Device) (Pool, error) {
	pool := Pool{Mount: mount, Members: []Member{}, DataProfiles: []string{}, MetadataProfiles: []string{}, SystemProfiles: []string{}}
	show, err := run(ctx, "btrfs", "filesystem", "show", "--raw", mount)
	if err != nil {
		return Pool{}, err
	}
	if err := parseShow(show, &pool); err != nil {
		return Pool{}, err
	}
	usage, err := run(ctx, "btrfs", "filesystem", "usage", "-b", mount)
	if err != nil {
		return Pool{}, err
	}
	parseUsage(usage, &pool)
	stats, err := run(ctx, "btrfs", "device", "stats", mount)
	if err != nil {
		return Pool{}, err
	}
	parseStats(stats, &pool)
	resolveMembers(&pool, devices)
	return pool, nil
}

func parseShow(raw string, pool *Pool) error {
	header := showHeader.FindStringSubmatch(raw)
	if header == nil {
		return errors.New("btrfs did not describe the pool")
	}
	pool.Label, pool.UUID = header[1], header[2]
	for line := range strings.SplitSeq(raw, "\n") {
		match := showMember.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		devid, _ := strconv.ParseInt(match[1], 10, 64)
		size, _ := strconv.ParseInt(match[2], 10, 64)
		used, _ := strconv.ParseInt(match[3], 10, 64)
		path := match[4]
		pool.Members = append(pool.Members, Member{
			DevID: devid, Size: size, Used: used, Path: path,
			Missing: strings.HasPrefix(path, "<missing") || strings.Contains(path, "MISSING"),
		})
	}
	if len(pool.Members) == 0 {
		return errors.New("the pool lists no devices")
	}
	return nil
}

func parseUsage(raw string, pool *Pool) {
	for line := range strings.SplitSeq(raw, "\n") {
		if match := usageValue.FindStringSubmatch(line); match != nil {
			if match[1] == "Data ratio" {
				pool.DataRatio, _ = strconv.ParseFloat(match[2], 64)
				continue
			}
			number, _ := strconv.ParseInt(match[2], 10, 64)
			switch match[1] {
			case "Device size":
				pool.DeviceSize = number
			case "Device allocated":
				pool.Allocated = number
			case "Used":
				pool.Used = number
			case "Free (estimated)":
				pool.FreeEstimated = number
			}
			continue
		}
		if match := usageProfile.FindStringSubmatch(line); match != nil {
			if match[1] != "Data" {
				used, _ := strconv.ParseInt(match[3], 10, 64)
				pool.MetadataUsed += used
			}
			profile := strings.ToLower(match[2])
			target := &pool.DataProfiles
			switch match[1] {
			case "Metadata":
				target = &pool.MetadataProfiles
			case "System":
				target = &pool.SystemProfiles
			}
			if !slices.Contains(*target, profile) {
				*target = append(*target, profile)
			}
		}
	}
}

func parseStats(raw string, pool *Pool) {
	for line := range strings.SplitSeq(raw, "\n") {
		match := statsLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		count, _ := strconv.ParseInt(match[3], 10, 64)
		for index := range pool.Members {
			member := &pool.Members[index]
			if !member.reportedAs(match[1]) {
				continue
			}
			switch match[2] {
			case "write_io_errs":
				member.Errors.Write = count
			case "read_io_errs":
				member.Errors.Read = count
			case "flush_io_errs":
				member.Errors.Flush = count
			case "corruption_errs":
				member.Errors.Corruption = count
			case "generation_errs":
				member.Errors.Generation = count
			}
		}
	}
}

// reportedAs matches a stats label: a device path, or devid:N for a missing member
func (member Member) reportedAs(label string) bool {
	return member.Path == label || (member.Missing && label == "devid:"+strconv.FormatInt(member.DevID, 10))
}

// resolveMembers maps member paths (a partition or a whole disk) to the owning device's identity
func resolveMembers(pool *Pool, devices []Device) {
	for index := range pool.Members {
		member := &pool.Members[index]
		for _, device := range devices {
			if device.Path == member.Path || slices.ContainsFunc(device.Partitions, func(part Partition) bool { return part.Path == member.Path }) {
				member.DeviceID = device.ID
				break
			}
		}
	}
}
