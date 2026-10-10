//go:build hosttest

package integrity

// Corrupts copies on real loop devices and verifies that scrub repairs one bad copy and reports two
import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/hosttest"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
)

const blockSize = 4096

func marker(block int) []byte { return fmt.Appendf(nil, "KAORDO-SCRUB-BLOCK-%08d", block) }

// writeMarkedFile writes blocks that each start with a unique marker, so they can be found on disk
func writeMarkedFile(t *testing.T, path string, blocks int) {
	t.Helper()
	content := make([]byte, 0, blocks*blockSize)
	for block := range blocks {
		chunk := bytes.Repeat([]byte{byte(block)}, blockSize)
		copy(chunk, marker(block))
		content = append(content, chunk...)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}

// corrupt overwrites the block that carries the marker on one device of an unmounted pool
func corrupt(t *testing.T, device string, block int) {
	t.Helper()
	file, err := os.OpenFile(device, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}()
	needle := marker(block)
	buffer := make([]byte, 16<<20)
	for offset := int64(0); ; offset += int64(len(buffer) - len(needle)) {
		read, err := file.ReadAt(buffer, offset)
		if index := bytes.Index(buffer[:read], needle); index >= 0 {
			if _, err := file.WriteAt(bytes.Repeat([]byte{0xee}, blockSize), offset+int64(index)); err != nil {
				t.Fatal(err)
			}
			if err := file.Sync(); err != nil {
				t.Fatal(err)
			}
			return
		}
		if errors.Is(err, io.EOF) {
			t.Fatalf("block %d not found on %s", block, device)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}

func scrub(t *testing.T, mount string) operation.Record {
	t.Helper()
	manager, err := operation.Open(t.TempDir(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	checker := Checker{Run: command.Run, Mount: mount, Poll: 50 * time.Millisecond, ScrubLimit: "0"}
	started, err := manager.Start(operation.Request{
		Kind: KindScrub, RequestedBy: "test", Exclusive: true, Cancellable: true, Stages: []string{"Verify every copy"},
		Run: checker.Scrub,
	})
	if err != nil {
		t.Fatal(err)
	}
	return waitFinished(t, manager, started.ID)
}

func TestScrubRepairsOneBadCopyAndReportsDataWithoutAGoodCopy(t *testing.T) {
	first := hosttest.Disk(t, "scrub-a", 2<<30)
	second := hosttest.Disk(t, "scrub-b", 2<<30)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-d", "raid1", "-m", "raid1", first, second)
	directory := t.TempDir()
	mount := func() string {
		hosttest.MustRun(t, "mount", first, directory)
		return directory
	}
	unmount := func() { hosttest.MustRun(t, "umount", directory) }
	t.Cleanup(func() { _, _ = command.Run(context.Background(), "umount", directory) })

	writeMarkedFile(t, filepath.Join(mount(), "data"), 4096)
	unmount()

	clean := scrub(t, mount())
	if clean.State != operation.Succeeded || clean.Log[len(clean.Log)-1].Message != "Scrub completed without uncorrectable errors" {
		t.Fatalf("clean scrub = %s %q %+v", clean.State, clean.Error, clean.Log)
	}
	if progress := clean.Stages[0].Progress; progress == nil || progress.Done != progress.Total {
		t.Fatalf("scrub progress = %+v", progress)
	}
	unmount()

	corrupt(t, first, 100)
	repaired := scrub(t, mount())
	if repaired.State != operation.Succeeded || repaired.Log[0].Message == "Scrub completed without uncorrectable errors" {
		t.Fatalf("repairing scrub = %s %q %+v", repaired.State, repaired.Error, repaired.Log)
	}
	unmount()

	corrupt(t, first, 200)
	corrupt(t, second, 200)
	failed := scrub(t, mount())
	if failed.State != operation.Failed || !bytes.Contains([]byte(failed.Error), []byte(ErrUncorrectable.Error())) {
		t.Fatalf("scrub of data without a good copy = %s %q", failed.State, failed.Error)
	}
}
