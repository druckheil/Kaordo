package deployment

// Verifies run status across the unit's lifetime and the newest record that alerts read
import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// systemd answers like a host whose deployment unit is in state
func systemd(state string, started *[]string) func(context.Context, ...string) (string, error) {
	return func(_ context.Context, args ...string) (string, error) {
		if args[1] == "start" {
			*started = append(*started, args[2])
		}
		return state + "\n", nil
	}
}

func write(t *testing.T, directory, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestStatusFollowsTheUnitAndItsRecord(t *testing.T) {
	directory := t.TempDir()
	var started []string
	for _, fixture := range []struct {
		unit, record, want string
	}{
		{"inactive", "", ""},
		{"activating", "", Waiting},
		// A re-run attempt starts over an earlier attempt's final record
		{"active", `{"run":7,"state":"failed","message":"old"}`, Waiting},
		{"active", `{"run":7,"state":"deploying"}`, Deploying},
		{"inactive", `{"run":7,"state":"succeeded","revision":"abc"}`, Succeeded},
		{"failed", `{"run":7,"state":"failed","rollbackFailed":true}`, Failed},
		{"failed", "", Failed},
	} {
		_ = os.Remove(filepath.Join(directory, "7.json"))
		if fixture.record != "" {
			write(t, directory, "7.json", fixture.record)
		}
		record, err := Deployments{Run: systemd(fixture.unit, &started), Directory: directory}.Status(context.Background(), 7)
		if fixture.want == "" {
			if !errors.Is(err, ErrUnknownRun) {
				t.Fatalf("unit %s without a record = %+v, %v", fixture.unit, record, err)
			}
			continue
		}
		if err != nil || record.State != fixture.want || record.Run != 7 {
			t.Fatalf("unit %s, record %s = %+v, %v", fixture.unit, fixture.record, record, err)
		}
		if fixture.unit == "failed" && fixture.record == "" && !strings.Contains(record.Message, "kaordo-deploy@7.service") {
			t.Fatalf("an unreported failure does not point at the unit: %q", record.Message)
		}
	}

	if _, err := (Deployments{Run: systemd("active", &started), Directory: directory}).Start(context.Background(), 9); err != nil {
		t.Fatal(err)
	}
	if len(started) != 1 || started[0] != "kaordo-deploy@9.service" {
		t.Fatalf("started %q", started)
	}
}

func TestLatestIsTheNewestRun(t *testing.T) {
	directory := t.TempDir()
	deployments := Deployments{Directory: filepath.Join(directory, "absent")}
	if latest, err := deployments.Latest(); latest != nil || err != nil {
		t.Fatalf("a host without deployments = %+v, %v", latest, err)
	}
	deployments.Directory = directory
	write(t, directory, "99.json", `{"run":99,"state":"failed"}`)
	write(t, directory, "100.json", `{"run":100,"state":"succeeded"}`)
	write(t, directory, "notes.txt", "ignored")
	latest, err := deployments.Latest()
	if err != nil || latest == nil || latest.Run != 100 || latest.State != Succeeded {
		t.Fatalf("latest = %+v, %v", latest, err)
	}
	write(t, directory, "101.json", `{`)
	if _, err := deployments.Latest(); err == nil {
		t.Fatal("a corrupt record was accepted")
	}
}
