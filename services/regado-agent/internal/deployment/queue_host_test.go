//go:build linux && hosttest

package deployment

// Reproduces ProtectSystem and the writable StateDirectory exception in an isolated mount namespace
import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
)

func TestQueueMountSandbox(t *testing.T) {
	if os.Getenv("KAORDO_QUEUE_SANDBOX_HELPER") != "1" {
		child := exec.CommandContext(t.Context(), "/proc/self/exe", "-test.run=^TestQueueMountSandbox$")
		child.Env = append(os.Environ(), "KAORDO_QUEUE_SANDBOX_HELPER=1")
		child.SysProcAttr = &syscall.SysProcAttr{Cloneflags: syscall.CLONE_NEWNS}
		if output, err := child.CombinedOutput(); err != nil {
			t.Fatalf("queue sandbox: %v\n%s", err, output)
		}
		return
	}
	directory := t.TempDir()
	queue := filepath.Join(directory, "queue")
	if err := os.Mkdir(queue, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mount("", "/", "", syscall.MS_PRIVATE|syscall.MS_REC, ""); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mount(directory, directory, "", syscall.MS_BIND, ""); err != nil {
		t.Fatal(err)
	}
	defer unmountQueueFixture(t, directory)
	if err := syscall.Mount("", directory, "", syscall.MS_REMOUNT|syscall.MS_BIND|syscall.MS_RDONLY, ""); err != nil {
		t.Fatal(err)
	}
	deployments := Deployments{Directory: queue}
	if err := deployments.Prepare(); !errors.Is(err, syscall.EROFS) {
		t.Fatalf("read-only queue: %v", err)
	}
	if err := syscall.Mount(queue, queue, "", syscall.MS_BIND, ""); err != nil {
		t.Fatal(err)
	}
	defer unmountQueueFixture(t, queue)
	if err := syscall.Mount("", queue, "", syscall.MS_REMOUNT|syscall.MS_BIND, ""); err != nil {
		t.Fatal(err)
	}
	if err := deployments.Prepare(); err != nil {
		t.Fatalf("writable queue exception: %v", err)
	}
	outside, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = outside.Close() }()
	if file, err := outside.OpenFile("outside", os.O_WRONLY|os.O_CREATE, 0o600); !errors.Is(err, syscall.EROFS) {
		if file != nil {
			_ = file.Close()
		}
		t.Fatalf("system root must remain read-only: %v", err)
	}
}

func unmountQueueFixture(t *testing.T, path string) {
	t.Helper()
	if err := syscall.Unmount(path, 0); err != nil {
		t.Errorf("unmount queue fixture: %v", err)
	}
}
