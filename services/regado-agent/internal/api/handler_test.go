package api

// Checks error statuses and strict request decoding without host tools
import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

func TestErrorsMapToStatuses(t *testing.T) {
	cases := map[error]int{
		fmt.Errorf("%w: pool", state.ErrInvalid): http.StatusUnprocessableEntity,
		fmt.Errorf("%w: issue", ErrNotReady):     http.StatusUnprocessableEntity,
		fmt.Errorf("%w: serial", ErrUnconfirmed): http.StatusUnprocessableEntity,
		state.ErrConflict:                        http.StatusConflict,
		ErrBusy:                                  http.StatusConflict,
		operation.ErrNotCancellable:              http.StatusConflict,
		operation.ErrNotFound:                    http.StatusNotFound,
		ErrIncomplete:                            http.StatusBadRequest,
		ErrUnknownCheck:                          http.StatusBadRequest,
		ErrCheckRunning:                          http.StatusConflict,
		integrity.ErrNothingToCheck:              http.StatusUnprocessableEntity,
		errors.New("btrfs: exit status 1"):       http.StatusBadGateway,
	}
	for err, want := range cases {
		if got := statusOf(err); got != want {
			t.Errorf("%v = %d, want %d", err, got, want)
		}
	}
}

func TestDecodeRejectsUnknownFieldsAndTrailingData(t *testing.T) {
	for _, body := range []string{`{"document":{},"unexpected":true}`, `{"reason":"a"} {"reason":"b"}`, `not json`} {
		recorder := httptest.NewRecorder()
		var change Change
		if decode(recorder, httptest.NewRequest(http.MethodPut, "/state", strings.NewReader(body)), &change) || recorder.Code != http.StatusBadRequest {
			t.Errorf("%s accepted with %d", body, recorder.Code)
		}
	}
}

func TestSettingsChangesStoreWithoutReadingDisks(t *testing.T) {
	states, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer states.Close()
	operations, err := operation.Open(t.TempDir(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer operations.Close()
	stored, _, err := states.Put(state.Default([]string{"wwn-0x50014ee0aaaa0001", "wwn-0x50014ee0aaaa0002"}))
	if err != nil {
		t.Fatal(err)
	}
	unreachable := func(context.Context, ...string) (string, error) { return "", errors.New("disks are not read") }
	service := &Service{Run: unreachable, States: states, Operations: operations}

	weekly := stored
	weekly.Integrity.Scrub = "weekly"
	result, err := service.Apply(context.Background(), Change{Document: weekly, RequestedBy: "admin"})
	if err != nil || result.Document.Revision != 2 || result.Operation != nil || result.Previous.Integrity.Scrub != "monthly" {
		t.Fatalf("settings change = %+v, %v", result, err)
	}
	if _, err := service.Apply(context.Background(), Change{Document: result.Document}); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("change without a requesting account = %v", err)
	}

	shorter := result.Document
	shorter.Cleanup.JournalDays = 7
	result, err = service.Apply(context.Background(), Change{Document: shorter, Reason: "Keep a week of logs", RequestedBy: "admin"})
	if err != nil || result.Operation == nil || result.Operation.Kind != "cleanup.journal" || result.Operation.Target != "7 days of history" {
		t.Fatalf("journal change = %+v, %v", result, err)
	}

	converge := result.Document
	if _, err := service.Apply(context.Background(), Change{Document: converge, Reason: "Finish the change", RequestedBy: "admin", Converge: true}); err == nil {
		t.Fatal("convergence did not read the disks")
	}
}
