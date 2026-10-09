//go:build hosttest

package storage

// Rehearses the deployed migration's data copy and cleanup on a real mirrored Btrfs pool
import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/hosttest"
)

func TestHostMigrationPreservesDataAndRetiresOnlyRecordedEntries(t *testing.T) {
	first := hosttest.Disk(t, "migration-a.img", 2*gib)
	second := hosttest.Disk(t, "migration-b.img", 2*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	mount := hosttest.Mount(t, first)
	for _, directory := range []string{"postgresql", "media", "prometheus", "releases", "secrets", "@migration"} {
		if err := os.Mkdir(filepath.Join(mount, directory), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	sum := writeData(t, mount)
	for _, file := range []string{"postgresql/data", "media/object", "secrets/key", ".hidden", "..hidden"} {
		if err := os.WriteFile(filepath.Join(mount, file), []byte("synthetic fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("data.bin", filepath.Join(mount, "data-link")); err != nil {
		t.Fatal(err)
	}
	script, err := filepath.Abs("../../../../deploy/nixos/migrate-to-pool.sh")
	if err != nil {
		t.Fatal(err)
	}
	// Run twice to prove an interrupted copy can be recreated without touching its source
	hosttest.MustRun(t, "bash", "-c", `source "$1"; top="$2"; move_data; move_data`, "migration", script, mount)
	migrated := filepath.Join(mount, "@kaordo")
	if checksum(t, migrated) != sum || checksum(t, mount) != sum {
		t.Fatal("migration changed file content")
	}
	shared := hosttest.MustRun(t, "btrfs", "filesystem", "du", "-s", filepath.Join(mount, "data.bin"), filepath.Join(migrated, "data.bin"))
	if strings.Count(shared, "0.00B") != 2 {
		t.Fatalf("reflink usage = %s", shared)
	}
	for _, volume := range []string{"postgresql", "media", "prometheus", "releases"} {
		hosttest.MustRun(t, "btrfs", "subvolume", "show", filepath.Join(migrated, volume))
	}
	for _, file := range []string{".hidden", "..hidden", "postgresql/data", "secrets/key"} {
		info, statErr := os.Stat(filepath.Join(migrated, file))
		if statErr != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("copied mode for %s: %v, %v", file, info, statErr)
		}
	}
	if target, linkErr := os.Readlink(filepath.Join(migrated, "data-link")); linkErr != nil || target != "data.bin" {
		t.Fatalf("copied symlink = %q, %v", target, linkErr)
	}
	if err := os.WriteFile(filepath.Join(mount, "created-later"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	hosttest.MustRun(t, "bash", "-c", `source "$1"; top="$2"; root_on_pool() { return 0; }; mount_top() { :; }; record_phase finalized; cleanup`, "migration", script, mount)
	if _, err := os.Stat(filepath.Join(mount, "data.bin")); !os.IsNotExist(err) {
		t.Fatalf("original data was not retired: %v", err)
	}
	if checksum(t, migrated) != sum {
		t.Fatal("cleanup changed the live copy")
	}
	if _, err := os.Stat(filepath.Join(mount, "created-later")); err != nil {
		t.Fatal("cleanup removed data outside the migration manifest")
	}
}
