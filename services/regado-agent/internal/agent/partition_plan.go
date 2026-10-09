package agent

// Generates Disko declarations and delegates incremental allocation to systemd-repart dry runs
import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type layoutRequest struct {
	Device       string `json:"device"`
	Identity     string `json:"identity"`
	Filesystem   string `json:"filesystem"`
	SystemBytes  int64  `json:"systemBytes"`
	StorageBytes int64  `json:"storageBytes"`
	Fingerprint  string `json:"fingerprint,omitempty"`
	Confirmation string `json:"confirmation,omitempty"`
}

type layoutStep struct {
	Kind         string `json:"kind"`
	Role         string `json:"role"`
	Number       int    `json:"number"`
	Start        int64  `json:"start"`
	Size         int64  `json:"size"`
	PreviousSize int64  `json:"previousSize"`
	Source       string `json:"source"`
}

type storagePlan struct {
	Device         string       `json:"device"`
	Identity       string       `json:"identity"`
	Fingerprint    string       `json:"fingerprint"`
	Supported      bool         `json:"supported"`
	Backend        string       `json:"backend"`
	Declaration    string       `json:"declaration"`
	Issues         []string     `json:"issues"`
	Warnings       []string     `json:"warnings"`
	SystemBytes    int64        `json:"systemBytes"`
	StorageBytes   int64        `json:"storageBytes"`
	AvailableBytes int64        `json:"availableBytes"`
	Steps          []layoutStep `json:"steps"`
}

type repartPartition struct {
	Label    string `json:"label"`
	Node     string `json:"node"`
	Number   int    `json:"partno"`
	Offset   int64  `json:"offset"`
	OldSize  int64  `json:"old_size"`
	Size     int64  `json:"raw_size"`
	Activity string `json:"activity"`
}

func storageStateDirectory() string {
	if path := os.Getenv("REGADO_STORAGE_STATE"); path != "" {
		return path
	}
	return "/var/lib/regado-agent"
}

func previewStoragePlan(ctx context.Context, run commandRunner, request layoutRequest) (storagePlan, error) {
	if !validStorageTarget(request.Device) || request.Identity == "" || len(request.Identity) > 256 || request.SystemBytes < 0 || request.StorageBytes < 0 {
		return storagePlan{}, errors.New("invalid device or role allocation")
	}
	device, mounts, err := layoutInventory(ctx, run, request)
	if err != nil {
		return storagePlan{}, err
	}
	plan := buildStoragePlan(device, request)
	if plan.Backend == "disko" {
		signatures, err := run(ctx, "wipefs", "--no-act", "--noheadings", "--output", "TYPE", request.Device)
		if err != nil || strings.TrimSpace(signatures) != "" {
			plan.Issues = append(plan.Issues, "Existing filesystem signatures must be reviewed through an offline migration.")
		}
	}
	if diskIsSwap(device, readSwapDevices()) {
		plan.Issues = append(plan.Issues, "An active swap partition is protected. Disable swap before changing this device.")
	}
	poolUUID := ""
	for _, mount := range mounts {
		if mount.Path == request.Filesystem && mount.Integrity != nil {
			poolUUID = mount.Integrity.UUID
		}
	}
	if plan.StorageBytes > 0 {
		if err := validateDataPool(ctx, run, request.Filesystem); err != nil {
			plan.Issues = append(plan.Issues, "Select an existing mounted Storage pool.")
		}
	}
	if plan.Backend == "systemd-repart" && len(plan.Issues) == 0 {
		if err := previewRepartAllocation(ctx, run, device, &plan); err != nil {
			return storagePlan{}, err
		}
	}
	plan.Supported = len(plan.Issues) == 0 && len(plan.Steps) > 0
	// Capacity use and SMART counters do not change a layout approval; geometry and pool identity do
	raw, _ := json.Marshal(struct {
		Request  layoutRequest
		Disk     disk
		PoolUUID string
	}{
		Request: layoutRequest{Device: request.Device, Identity: request.Identity, Filesystem: request.Filesystem, SystemBytes: request.SystemBytes, StorageBytes: request.StorageBytes}, Disk: planIdentity(device), PoolUUID: poolUUID,
	})
	sum := sha256.Sum256(raw)
	plan.Fingerprint = hex.EncodeToString(sum[:])
	return plan, nil
}

func previewRepartAllocation(ctx context.Context, run commandRunner, device disk, plan *storagePlan) error {
	definitions, err := repartDefinitions(device, *plan)
	if err != nil {
		plan.Issues = append(plan.Issues, err.Error())
		return nil
	}
	work, err := writeLayoutWorkspace(definitions, "")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	raw, err := run(ctx, repartArgs(work, plan.Device, true)...)
	if err != nil {
		plan.Issues = append(plan.Issues, "systemd-repart cannot fit the requested areas without moving existing partitions.")
		return nil
	}
	plan.Steps, err = validatedRepartSteps(raw, device, *plan)
	if err != nil {
		plan.Issues = append(plan.Issues, err.Error())
	}
	return nil
}

func layoutInventory(ctx context.Context, run commandRunner, request layoutRequest) (disk, []mount, error) {
	disks, err := readDisks(ctx, run, nil)
	if err != nil {
		return disk{}, nil, err
	}
	readDiskLayouts(ctx, run, disks)
	markSystemDisks(disks)
	mounts := readMounts(ctx, run, disks)
	assignPartitionRoles(disks, mounts)
	device, found := findPhysicalDisk(disks, request.Device)
	identical := 0
	for _, candidate := range disks {
		if deviceIdentity(candidate) == request.Identity {
			identical++
		}
	}
	if !found || deviceIdentity(device) != request.Identity || identical != 1 {
		return disk{}, nil, errors.New("device identity changed; refresh the inventory")
	}
	return device, mounts, nil
}

func planIdentity(device disk) disk {
	device.Health = nil
	device.StorageState, device.ConfigureReason = "", ""
	device.ConfigureEligible = false
	device.Children = slices.Clone(device.Children)
	for i := range device.Children {
		device.Children[i] = planIdentity(device.Children[i])
	}
	return device
}

func buildStoragePlan(device disk, request layoutRequest) storagePlan {
	plan := storagePlan{Device: device.Path, Identity: request.Identity, Backend: "disko", Issues: []string{}, Warnings: []string{}, Steps: []layoutStep{}, SystemBytes: alignDown(request.SystemBytes), StorageBytes: alignDown(request.StorageBytes)}
	plan.Declaration = diskoDeclaration(request.Device, request.Identity, plan.SystemBytes, plan.StorageBytes, hostBootMode())
	if plan.SystemBytes == 0 && plan.StorageBytes == 0 {
		plan.Issues = append(plan.Issues, "Allocate at least one System or Storage area.")
		return plan
	}
	if len(device.Children) == 0 && valueOrEmpty(device.FSType) == "" && !device.LayoutAvailable {
		planBlankDevice(device, &plan)
	} else {
		if !planExistingDevice(device, &plan) {
			return plan
		}
	}
	if plan.SystemBytes > 0 && plan.SystemBytes < 256*partitionAlignment {
		plan.Issues = append(plan.Issues, "System areas need at least 256 MiB.")
	}
	if plan.StorageBytes > 0 && plan.StorageBytes < 1<<30 {
		plan.Issues = append(plan.Issues, "Storage areas need at least 1 GiB.")
	}
	plan.Warnings = append(plan.Warnings, "System volumes are prepared for operating-system or service data. Installing NixOS and moving existing service data are separate maintenance operations.")
	plan.Supported = len(plan.Issues) == 0
	return plan
}

func planBlankDevice(device disk, plan *storagePlan) {
	reserve := 2 * partitionAlignment
	if plan.SystemBytes > 0 {
		reserve += bootMetadataBytes(hostBootMode())
	}
	plan.AvailableBytes = alignDown(device.Size - reserve)
	if plan.SystemBytes > plan.AvailableBytes || plan.StorageBytes > plan.AvailableBytes-plan.SystemBytes {
		plan.Issues = append(plan.Issues, "Requested areas exceed usable capacity after GPT and boot metadata.")
	}
	if plan.SystemBytes > 0 {
		plan.Steps = append(plan.Steps, layoutStep{Kind: "create", Role: "system", Size: plan.SystemBytes})
	}
	if plan.StorageBytes > 0 {
		plan.Steps = append(plan.Steps, layoutStep{Kind: "create", Role: "storage", Size: plan.StorageBytes})
	}
}

func planExistingDevice(device disk, plan *storagePlan) bool {
	plan.Backend = "systemd-repart"
	if !device.LayoutAvailable || valueOrEmpty(device.FSType) != "" {
		plan.Issues = append(plan.Issues, "Existing geometry must be discovered before incremental changes.")
		return false
	}
	current := map[string]int64{}
	for _, part := range device.Children {
		if part.BootKind != "" {
			continue
		}
		if part.Type != "part" || part.Role == "unassigned" {
			plan.Issues = append(plan.Issues, fmt.Sprintf("%s is an unmanaged volume; its data will be preserved.", part.Path))
			continue
		}
		current[part.Role] += part.Size
		plan.AvailableBytes += part.Size
	}
	for _, region := range device.Unallocated {
		plan.AvailableBytes += region.Size
	}
	for _, role := range []string{"system", "storage"} {
		desired := plan.SystemBytes
		if role == "storage" {
			desired = plan.StorageBytes
		}
		if desired < current[role] {
			plan.Issues = append(plan.Issues, "Shrinking or removing an existing area requires an offline migration. Disko declarations can be exported; live repartitioning never erases data.")
		}
		if current[role] > 0 && desired != current[role] && role == "system" {
			plan.Issues = append(plan.Issues, "The existing System area is protected; resize it through an offline maintenance workflow.")
		}
	}
	pending := slices.ContainsFunc(device.Children, partitionNeedsActivation)
	if plan.SystemBytes == current["system"] && plan.StorageBytes == current["storage"] && !pending {
		plan.Issues = append(plan.Issues, "The requested layout already matches this device.")
	}
	if plan.SystemBytes > plan.AvailableBytes || plan.StorageBytes > plan.AvailableBytes-plan.SystemBytes {
		plan.Issues = append(plan.Issues, "Requested areas exceed usable capacity.")
	}
	return true
}

func repartDefinitions(device disk, plan storagePlan) (map[string]string, error) {
	definitions := map[string]string{}
	storageParts, storageTotal := 0, int64(0)
	for _, part := range device.Children {
		if part.Role == "storage" {
			storageParts++
			storageTotal += part.Size
		}
	}
	parts := slices.Clone(device.Children)
	slices.SortFunc(parts, func(a, b disk) int { return a.Number - b.Number })
	current := map[string]int64{}
	for _, part := range parts {
		if part.Number == 0 || part.Start == 0 || valueOrEmpty(part.PartitionType) == "" {
			return nil, errors.New("Partition type and geometry are required for incremental changes.")
		}
		if part.BootKind == "" {
			current[part.Role] += part.Size
		}
		size := part.Size
		if part.Role == "storage" && plan.StorageBytes > storageTotal {
			if storageParts > 1 {
				return nil, errors.New("Manage multiple Storage partitions through a separate migration.")
			}
			size = plan.StorageBytes
		}
		// Match definitions in partition-number order; labels and UUIDs are not matching criteria in repart
		definitions[fmt.Sprintf("%03d-existing.conf", part.Number)] = partitionDefinition(valueOrEmpty(part.PartitionType), "", size, false)
	}
	if plan.SystemBytes > 0 && current["system"] == 0 {
		definitions["800-system.conf"] = partitionDefinition("linux-generic", "kaordo-system", plan.SystemBytes, true)
	}
	if plan.StorageBytes > 0 && current["storage"] == 0 {
		definitions["900-storage.conf"] = partitionDefinition("linux-generic", "kaordo-storage", plan.StorageBytes, false)
	}
	return definitions, nil
}

func partitionDefinition(kind, label string, size int64, format bool) string {
	result := fmt.Sprintf("[Partition]\nType=%s\nSizeMinBytes=%d\nSizeMaxBytes=%d\n", kind, size, size)
	if label != "" {
		result += "Label=" + label + "\n"
	}
	if format {
		result += "Format=ext4\n"
	}
	return result
}

func writeLayoutWorkspace(definitions map[string]string, declaration string) (string, error) {
	root := storageStateDirectory()
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	work, err := os.MkdirTemp(root, "layout-")
	if err != nil {
		return "", err
	}
	files := definitions
	if declaration != "" {
		files = map[string]string{"disko.nix": declaration}
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(work, name), []byte(content), 0600); err != nil {
			_ = os.RemoveAll(work)
			return "", err
		}
	}
	return work, nil
}

func repartArgs(work, device string, dry bool) []string {
	return []string{"systemd-repart", "--dry-run=" + strconv.FormatBool(dry), "--empty=refuse", "--discard=no", "--json=short", "--pretty=no", "--definitions=" + work, device}
}

func validatedRepartSteps(raw string, device disk, plan storagePlan) ([]layoutStep, error) {
	start := strings.Index(raw, "[{")
	if start < 0 {
		return nil, errors.New("systemd-repart returned no partition preview")
	}
	var proposed []repartPartition
	if err := json.NewDecoder(strings.NewReader(raw[start:])).Decode(&proposed); err != nil {
		return nil, err
	}
	steps := []layoutStep{}
	seen := map[string]bool{}
	roles := map[string]int64{}
	nodes := map[string]bool{}
	existingParts := make(map[string]disk, len(device.Children))
	for _, part := range device.Children {
		existingParts[part.Path] = part
	}
	for _, candidate := range proposed {
		if nodes[candidate.Node] || candidate.Number < 0 || partitionNumber(device.Path, candidate.Node) != candidate.Number+1 || candidate.Offset <= 0 || candidate.Size <= 0 || candidate.Offset > device.Size || candidate.Size > device.Size-candidate.Offset {
			return nil, errors.New("Invalid partition geometry was refused.")
		}
		nodes[candidate.Node] = true
		if existing, found := existingParts[candidate.Node]; found {
			seen[existing.Path] = true
			if existing.BootKind == "" {
				roles[existing.Role] += candidate.Size
			}
			step, err := preservedPartitionStep(existing, candidate)
			if err != nil {
				return nil, err
			}
			if step != nil {
				steps = append(steps, *step)
			}
			continue
		}
		step, err := createdPartitionStep(candidate)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
		roles[step.Role] += step.Size
	}
	if len(seen) != len(device.Children) {
		return nil, errors.New("The preview did not preserve every existing partition.")
	}
	if roles["system"] != plan.SystemBytes || roles["storage"] != plan.StorageBytes {
		return nil, errors.New("The native preview does not match the requested role sizes.")
	}
	slices.SortFunc(proposed, func(a, b repartPartition) int { return cmp.Compare(a.Offset, b.Offset) })
	for index := 1; index < len(proposed); index++ {
		previous := proposed[index-1]
		if previous.Offset+previous.Size > proposed[index].Offset {
			return nil, errors.New("Overlapping partition geometry was refused.")
		}
	}
	return steps, nil
}

func preservedPartitionStep(existing disk, candidate repartPartition) (*layoutStep, error) {
	if candidate.Offset != existing.Start || candidate.OldSize != existing.Size || candidate.Size < existing.Size {
		return nil, errors.New("The preview would move or shrink existing data.")
	}
	if candidate.Size > existing.Size {
		if existing.Role != "storage" || valueOrEmpty(existing.FSType) != "btrfs" {
			return nil, errors.New("Only a Btrfs Storage partition can grow online.")
		}
		return &layoutStep{Kind: "resize", Role: "storage", Number: existing.Number, Start: existing.Start,
			Size: candidate.Size, PreviousSize: existing.Size, Source: existing.Path}, nil
	}
	if partitionNeedsActivation(existing) {
		return &layoutStep{Kind: "activate", Role: existing.Role, Number: existing.Number, Start: existing.Start,
			Size: existing.Size, Source: existing.Path}, nil
	}
	return nil, nil
}

func createdPartitionStep(candidate repartPartition) (layoutStep, error) {
	role := map[string]string{"kaordo-system": "system", "kaordo-storage": "storage"}[candidate.Label]
	if role == "" || candidate.OldSize != 0 || candidate.Activity != "create" || candidate.Size <= 0 {
		return layoutStep{}, errors.New("Unexpected partition change was refused.")
	}
	return layoutStep{Kind: "create", Role: role, Number: candidate.Number + 1, Start: candidate.Offset,
		Size: candidate.Size, Source: candidate.Node}, nil
}

func partitionNeedsActivation(part disk) bool {
	if len(nonEmptyMountpoints(part.Mountpoints)) > 0 || len(part.Children) > 0 {
		return false
	}
	switch valueOrEmpty(part.PartitionLabel) {
	case "kaordo-storage":
		return valueOrEmpty(part.FSType) == ""
	case "kaordo-system":
		return valueOrEmpty(part.FSType) == "ext4"
	default:
		return false
	}
}

func bootMetadataBytes(mode string) int64 {
	if mode == "uefi" {
		return 512 * partitionAlignment
	}
	return 2 * partitionAlignment
}

func diskoDeclaration(device, identity string, system, storage int64, bootMode string) string {
	var config strings.Builder
	// Disko resolves filesystem targets by PARTUUID, preventing duplicate role labels from selecting another disk
	partitionUUID := func(role string) string {
		return uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://kaordo.link/storage/"+identity+"/"+role)).String()
	}
	quotedDevice := strings.ReplaceAll(strconv.Quote(device), "${", `\${`)
	fmt.Fprintf(&config, "# Generated role allocation; Storage membership is managed by btrfs-progs\n{\n  disko.devices.disk.device = {\n    type = \"disk\";\n    device = %s;\n    content = {\n      type = \"gpt\";\n      partitions = {\n", quotedDevice)
	if system > 0 {
		if bootMode == "uefi" {
			fmt.Fprintf(&config, `        boot = {
          size = "512M"; type = "EF00"; label = "kaordo-boot"; priority = 100; uuid = "%s";
          content = { type = "filesystem"; format = "vfat"; mountpoint = "/boot"; mountOptions = [ "umask=0077" ]; };
        };
`, partitionUUID("boot"))
		} else {
			fmt.Fprintf(&config, `        boot = { size = "2M"; type = "EF02"; label = "kaordo-boot"; priority = 100; uuid = "%s"; };
`, partitionUUID("boot"))
		}
		fmt.Fprintf(&config, `        system = {
          size = "%dM"; type = "8300"; label = "kaordo-system"; priority = 200; uuid = "%s";
          content = { type = "filesystem"; format = "ext4"; extraArgs = [ "-L" "KaordoSystem" ]; mountpoint = "/"; };
        };
`, system/partitionAlignment, partitionUUID("system"))
	}
	if storage > 0 {
		fmt.Fprintf(&config, `        storage = { size = "%dM"; type = "8300"; label = "kaordo-storage"; priority = 300; uuid = "%s"; };
`, storage/partitionAlignment, partitionUUID("storage"))
	}
	config.WriteString("      };\n    };\n  };\n}\n")
	return config.String()
}
