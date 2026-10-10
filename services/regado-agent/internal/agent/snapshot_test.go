package agent

// Verifies swap parsing for the System view
import "testing"

func TestSwapParsingSeparatesCompressedRAMFromDiskSwap(t *testing.T) {
	items := parseSwapDevices("Filename Type Size Used Priority\n/dev/zram0 partition 4194304 1024 100\n/dev/sda3 partition 8388608 2048 -2\n/var/swapfile file 1024 0 1\n")
	if len(items) != 3 {
		t.Fatalf("swap devices = %+v", items)
	}
	if items[0].Kind != "compressed RAM" || items[0].Size != 4<<30 || items[0].Used != 1<<20 {
		t.Fatalf("zram stats = %+v", items[0])
	}
	if items[1].Kind != "disk swap" || items[1].Priority != -2 {
		t.Fatalf("disk swap = %+v", items[1])
	}
	if items[2].Kind != "swap file" {
		t.Fatalf("swap file = %+v", items[2])
	}
}
