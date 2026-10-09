package agent

// Exercises storage onboarding preflight and the exact fixed command sequence
import (
	"context"
	"testing"
)

func TestLegacyStorageSetupOnlyApprovesAnIdentifiedBlankDevice(t *testing.T) {
	run := func(_ context.Context, args ...string) (string, error) {
		if args[0] != "lsblk" {
			t.Fatalf("unexpected mutation during layout selection: %v", args)
		}
		return `{"blockdevices":[{"name":"sdc","path":"/dev/sdc","type":"disk","size":10737418240,"serial":"new-disk","children":[]}]}`, nil
	}
	request, err := legacyStorageLayout(context.Background(), run, storageActionRequest{Target: "/dev/sdc", Identity: "serial:new-disk", Filesystem: "/srv/data"})
	if err != nil || request.StorageBytes != (10<<30)-2*partitionAlignment || request.SystemBytes != 0 {
		t.Fatalf("layout = %+v / %v", request, err)
	}
}

func TestConfigureStorageRejectsChangedIdentityWithoutRunningCommands(t *testing.T) {
	called := false
	run := func(_ context.Context, _ ...string) (string, error) {
		called = true
		return `{"blockdevices":[{"name":"sdc","path":"/dev/sdc","type":"disk","size":1000,"serial":"replacement","mountpoints":[],"children":[]}]}`, nil
	}
	_, err := legacyStorageLayout(context.Background(), run, storageActionRequest{
		Target: "/dev/sdc", Identity: "serial:old-device", Filesystem: "/srv/data",
	})
	if err == nil || !called {
		t.Fatalf("identity mismatch = %v, command called = %t", err, called)
	}
	if validStorageTarget("/dev/../../etc/passwd") || validMountPath("/srv/data/../") {
		t.Fatal("unsafe storage paths accepted")
	}
}
