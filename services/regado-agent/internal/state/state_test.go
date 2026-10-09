package state

// Verifies document validation and revision-checked persistence
import (
	"errors"
	"testing"
)

func TestDefaultDocumentsAreValid(t *testing.T) {
	for _, devices := range [][]string{{"wwn-0x50014ee2b1c2d3e4"}, {"wwn-0x50014ee2b1c2d3e4", "ata-WDC_WD10EADS-00L5B1_WD-WCAV51234567"}} {
		if err := Default(devices).Validate(); err != nil {
			t.Fatalf("default for %d devices: %v", len(devices), err)
		}
	}
}

func TestValidationRejectsUnsafeDocuments(t *testing.T) {
	pair := []string{"wwn-0x50014ee2b1c2d3e4", "wwn-0x50014ee05a6b7c8d"}
	quota := int64(1 << 20)
	cases := map[string]func(*Document){
		"kernel device name":       func(d *Document) { d.Pool.Devices = []string{"sda", "sdb"} },
		"duplicate device":         func(d *Document) { d.Pool.Devices = []string{pair[0], pair[0]} },
		"three copies on two":      func(d *Document) { d.Pool.DataProfile = "raid1c3" },
		"metadata below data":      func(d *Document) { d.Pool.MetadataProfile = "single" },
		"unknown volume":           func(d *Document) { d.Volumes["home"] = Volume{} },
		"tiny quota":               func(d *Document) { d.Volumes["media"] = Volume{QuotaBytes: &quota} },
		"schedule keeping nothing": func(d *Document) { d.Snapshots["media"] = SnapshotPolicy{Schedule: "daily"} },
		"daily scrub":              func(d *Document) { d.Integrity.Scrub = "daily" },
		"backup on a pool disk": func(d *Document) {
			d.Backups.Targets = []BackupTarget{{ID: "spare", Kind: "disk", Device: pair[0]}}
		},
		"policy without target": func(d *Document) {
			d.Backups.Policies = []BackupPolicy{{Volume: "media", Target: "missing", Schedule: "daily", KeepDaily: 7}}
		},
		"single release kept": func(d *Document) { d.Cleanup.ReleasesKeep = 1 },
		"inverted thresholds": func(d *Document) { d.Alerts.PoolWarningPercent, d.Alerts.PoolCriticalPercent = 90, 80 },
		"plain http ntfy":     func(d *Document) { d.Alerts.Ntfy = &NtfyChannel{URL: "http://ntfy.sh", Topic: "kaordo-alerts"} },
	}
	for name, mutate := range cases {
		document := Default(pair)
		mutate(&document)
		if err := document.Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestStoreRejectsStaleRevisions(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.Current(); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty store = %v", err)
	}
	first, previous, err := store.Put(Default([]string{"wwn-0x50014ee2b1c2d3e4", "wwn-0x50014ee05a6b7c8d"}))
	if err != nil || first.Revision != 1 || previous != nil {
		t.Fatalf("first put = %+v, %v, %v", first, previous, err)
	}
	edited := first
	edited.Integrity.Scrub = "weekly"
	second, previous, err := store.Put(edited)
	if err != nil || second.Revision != 2 || previous == nil || previous.Integrity.Scrub != "monthly" {
		t.Fatalf("second put = %+v, %+v, %v", second, previous, err)
	}
	if _, _, err := store.Put(first); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale put = %v", err)
	}
	reopened, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	current, err := reopened.Current()
	if err != nil || current.Revision != 2 || current.Integrity.Scrub != "weekly" {
		t.Fatalf("reopened current = %+v, %v", current, err)
	}
	if old, err := reopened.Revision(1); err != nil || old.Integrity.Scrub != "monthly" {
		t.Fatalf("revision 1 = %+v, %v", old, err)
	}
}

func TestHistoryKeepsTheNewestRevisions(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	document := Default([]string{"wwn-0x50014ee2b1c2d3e4"})
	for range keepHistory + 5 {
		if document, _, err = store.Put(document); err != nil {
			t.Fatal(err)
		}
	}
	revisions, err := store.Revisions()
	if err != nil || len(revisions) != keepHistory || revisions[0] != int64(keepHistory+5) {
		t.Fatalf("revisions = %v, %v", revisions, err)
	}
}
