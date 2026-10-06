package main

// Checks real partition gaps, physical capacity, and scrub results across every device
import (
	"testing"
)

func TestDiskLayoutIncludesTheUnpartitionedSystemSizedGap(t *testing.T) {
	raw := "BYT;\n/dev/sda:1000204886016B:scsi:512:512:gpt:ATA disk:;\n" +
		"1:17408B:1048575B:1031168B:free;\n1:1048576B:3145727B:2097152B::primary:bios_grub;\n" +
		"1:3145728B:68722622463B:68719476736B:free;\n2:68722622464B:1000204140543B:931481518080B:btrfs:Data1:;\n"
	regions, available := parseFreeRegions(raw)
	if !available || len(regions) != 2 || regions[1].Size != 64<<30 || regions[1].Start != 3145728 {
		t.Fatalf("free regions = %+v, available = %t", regions, available)
	}
	if _, available := parseFreeRegions("unavailable"); available {
		t.Fatal("invalid layout reported as available")
	}
	total, used := parsePhysicalUsage("Overall:\n Device size: 1862963036160\n Device allocated: 13086228480\n Used: 3075268608\nData,RAID1: Size: 5368709120, Used: 1531736064")
	if total != 1862963036160 || used != 3075268608 {
		t.Fatalf("physical capacity = %d / %d", used, total)
	}
	name, version := parseOSRelease("NAME=\"NixOS\"\nVERSION_ID=\"26.05\"\nPRETTY_NAME=\"NixOS 26.05\"\n")
	if name != "NixOS" || version != "26.05" {
		t.Fatalf("OS = %q %q", name, version)
	}
}

func TestScrubChecksAllDeviceResults(t *testing.T) {
	clean := "Status: finished\nError summary: no errors found\n"
	for _, test := range []struct {
		output, state string
		errors        int64
	}{
		{clean + clean, "complete", 0},
		{clean + "Status: finished\nError summary: read=2 corruption=1\n", "errors", 3},
		{clean + "Status:   running\nError summary: no errors found\n", "running", 0},
		{clean + "Status: cancelled\nError summary: no errors found\n", "unknown", 0},
	} {
		if state, errors := parseScrubState(test.output), parseScrubErrors(test.output); state != test.state || errors != test.errors {
			t.Fatalf("%q: %s / %d, want %s / %d", test.output, state, errors, test.state, test.errors)
		}
	}
}
