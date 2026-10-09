package api

// Checks error statuses and strict request decoding without host tools
import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
