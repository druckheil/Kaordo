package storage

// Checks the GRUB command and root-on-pool detection without touching devices
import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
)

func TestGRUBInstallsByStableIdentity(t *testing.T) {
	var got string
	grub := GRUB{Directory: "/boot", Run: func(_ context.Context, args ...string) (string, error) {
		got = strings.Join(args, " ")
		return "", nil
	}}
	if err := grub.Install(context.Background(), host.Device{ID: "wwn-0x50014ee1020d4d4f", Path: "/dev/sda"}); err != nil {
		t.Fatal(err)
	}
	if got != "grub-install --target=i386-pc --boot-directory=/boot /dev/disk/by-id/wwn-0x50014ee1020d4d4f" {
		t.Fatalf("command = %q", got)
	}
}

func TestRootOnPool(t *testing.T) {
	for _, fixture := range []struct {
		root, pool string
		fail       bool
		want       bool
	}{
		{"e1b53e8e\n", "e1b53e8e\n", false, true},
		{"e1fbdadd\n", "e1b53e8e\n", false, false},
		{"\n", "\n", false, false},
		{"e1b53e8e\n", "e1b53e8e\n", true, false},
	} {
		run := func(_ context.Context, args ...string) (string, error) {
			if fixture.fail {
				return "", errors.New("findmnt failed")
			}
			if args[len(args)-1] == "/" {
				return fixture.root, nil
			}
			return fixture.pool, nil
		}
		if got := RootOnPool(context.Background(), run, "/srv/kaordo"); got != fixture.want {
			t.Errorf("%+v = %v", fixture, got)
		}
	}
}
