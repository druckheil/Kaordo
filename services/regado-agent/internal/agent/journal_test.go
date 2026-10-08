package agent

// Verifies journal measurements, retention validation, policy persistence and failure recovery
import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJournalSettingsAndAllocatedBytes(t *testing.T) {
	settings := journalSettings("# MaxRetentionSec=90day\n[Journal]\nSystemMaxUse=256M\nMaxRetentionSec=14day\nMaxRetentionSec=7day\n")
	if value := journalDays(settings["MaxRetentionSec"]); value == nil || *value != 7 {
		t.Fatalf("days=%v", value)
	}
	if value := journalSize(settings["SystemMaxUse"]); value == nil || *value != 256<<20 {
		t.Fatalf("bytes=%v", value)
	}
	for _, raw := range []string{"14day", "14days", "14d", "1209600s", "336h"} {
		if value := journalDays(raw); value == nil || *value != 14 {
			t.Fatalf("duration %s = %v", raw, value)
		}
	}
	if journalDays("1h") != nil || journalSize("10%") != nil || journalSize("9223372036854775807G") != nil {
		t.Fatal("unknown or overflowing configuration was guessed")
	}
	root := t.TempDir()
	path := filepath.Join(root, "system.journal")
	if err := os.WriteFile(path, make([]byte, 8192), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ignore.txt"), make([]byte, 65536), 0600); err != nil {
		t.Fatal(err)
	}
	bytes := journalBytes(context.Background(), root)
	if bytes == nil || *bytes <= 0 || *bytes >= 65536 {
		t.Fatalf("journal usage=%v", bytes)
	}
	if journalBytes(context.Background(), filepath.Join(root, "missing")) != nil {
		t.Fatal("missing journal was counted as empty")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if journalBytes(ctx, root) != nil {
		t.Fatal("cancelled inventory was counted as complete")
	}
}

func TestJournalPolicyPersistenceRecoveryAndNativeCleanup(t *testing.T) {
	for _, mode := range []string{"success", "size only", "restart fails", "cleanup fails", "overridden", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			policy, link := filepath.Join(root, "policy.conf"), filepath.Join(root, "link.conf")
			previous := "[Journal]\nMaxRetentionSec=14day\n"
			if err := os.WriteFile(policy, []byte(previous), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(policy, link); err != nil {
				t.Fatal(err)
			}
			restarts := 0
			var mutations []string
			run := func(_ context.Context, args ...string) (string, error) {
				command := strings.Join(args, " ")
				if args[0] == "systemd-analyze" {
					value, err := os.ReadFile(policy)
					if mode == "overridden" {
						value = append(value, []byte("\nMaxRetentionSec=90day\n")...)
					}
					return "[Journal]\nSystemMaxUse=256M\n" + string(value), err
				}
				mutations = append(mutations, command)
				if args[0] == "systemctl" {
					restarts++
					if mode == "restart fails" && restarts == 1 {
						return "", errors.New("restart unavailable")
					}
				}
				if mode == "cleanup fails" && args[0] == "journalctl" {
					return "", errors.New("cleanup unavailable")
				}
				return "", nil
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			days := 7
			if mode == "size only" {
				days = 0
			}
			status, err := applyJournalRetention(ctx, run, days, link, policy)
			value, _ := os.ReadFile(policy)
			if mode == "restart fails" || mode == "overridden" || mode == "cancelled" {
				if err == nil || string(value) != previous {
					t.Fatalf("failed policy retained changes: err=%v file=%s", err, value)
				}
				if mode == "restart fails" && restarts != 2 {
					t.Fatalf("previous daemon policy was not restored: %v", mutations)
				}
				for _, command := range mutations {
					if strings.HasPrefix(command, "journalctl") {
						t.Fatal("history was removed after a failed policy")
					}
				}
				return
			}
			if err != nil || status.RetentionDays == nil || *status.RetentionDays != days || !strings.Contains(string(value), "MaxRetentionSec=") {
				t.Fatalf("policy err=%v status=%+v", err, status)
			}
			info, _ := os.Stat(policy)
			if info.Mode().Perm() != 0600 {
				t.Fatal("policy permissions are not private")
			}
			if mode == "cleanup fails" && status.Warning == "" {
				t.Fatal("cleanup failure was hidden")
			}
			if mode == "success" && strings.Join(mutations, ";") != "systemctl restart systemd-journald.service;journalctl --rotate;journalctl --vacuum-time=7d --vacuum-size=268435456" {
				t.Fatalf("unexpected operations: %v", mutations)
			}
			if mode == "size only" && strings.Contains(strings.Join(mutations, ";"), "vacuum-time") {
				t.Fatal("size-only policy still deletes by age")
			}
		})
	}
}

func TestJournalRetentionRejectsUnsupportedBodiesBeforeCommands(t *testing.T) {
	for _, body := range []string{"{}", `{"retentionDays":null}`, `{"retentionDays":-1}`, `{"retentionDays":10000}`, `{"retentionDays":"7"}`, `{"retentionDays":7,"path":"/etc"}`, `{"retentionDays":7} {}`} {
		called := false
		response := httptest.NewRecorder()
		journalRetentionHandler(func(context.Context, ...string) (string, error) { called = true; return "", nil }).ServeHTTP(response, httptest.NewRequest("PATCH", "/logs/retention", strings.NewReader(body)))
		if response.Code != 400 || called {
			t.Fatalf("unsafe body accepted: %s status=%d", body, response.Code)
		}
	}
}
