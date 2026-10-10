package storage

// Installs GRUB's BIOS boot code on a pool device, so any pool member can start the host
import (
	"context"
	"strings"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
)

// GRUB writes boot code to a device's BIOS boot partition. The menu and modules live in the
// pool's /boot, which NixOS keeps current; this only lets a new member start the same menu.
type GRUB struct {
	Run       command.Runner
	Directory string
}

func (grub GRUB) Install(ctx context.Context, device host.Device) error {
	_, err := grub.Run(ctx, "grub-install", "--target=i386-pc", "--boot-directory="+grub.Directory, "/dev/disk/by-id/"+device.ID)
	return err
}

// RootOnPool reports whether / is a subvolume of the pool mounted at mount; only then does
// the pool carry the bootloader's menu and every member needs boot code.
func RootOnPool(ctx context.Context, run command.Runner, mount string) bool {
	root, err := run(ctx, "findmnt", "--noheadings", "--output", "UUID", "/")
	if err != nil {
		return false
	}
	pool, err := run(ctx, "findmnt", "--noheadings", "--output", "UUID", mount)
	return err == nil && strings.TrimSpace(root) != "" && strings.TrimSpace(root) == strings.TrimSpace(pool)
}
