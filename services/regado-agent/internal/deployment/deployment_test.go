package deployment

// Verifies reading the controller's state on hosts with and without automatic deployment
import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadReportsTheAttemptOrNothing(t *testing.T) {
	directory := t.TempDir()
	for _, absent := range []string{filepath.Join(directory, "absent"), directory} {
		if state, err := Read(absent); state != nil || err != nil {
			t.Fatalf("a host without deployment = %+v, %v", state, err)
		}
	}
	path := filepath.Join(directory, "state.json")
	if err := os.WriteFile(path, []byte(`{"phase":"failed","activeCommit":"b","failedAttempt":"a1b2:7:2","error":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := Read(directory)
	if err != nil || state.Phase != Failed || state.Revision() != "a1b2" || state.Error != "x" {
		t.Fatalf("state = %+v, %v", state, err)
	}
	if err := os.WriteFile(path, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(directory); err == nil {
		t.Fatal("a corrupt state was accepted")
	}
}
