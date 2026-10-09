package agent

// Checks timer-aware telemetry and DNS checks without interrupting scheduled work
import (
	"context"
	"errors"
	"math"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/journal"
)

func TestServiceOutcomeAndNativeTimer(t *testing.T) {
	status := parseServiceStatus("ddclient", "ActiveState=inactive\nSubState=dead\nLoadState=loaded\nType=oneshot\nResult=success\nExecMainStatus=0\nExecMainExitTimestamp=@1791100000\n")
	if status.Type != "oneshot" || status.Result != "success" || status.ExitCode == nil || *status.ExitCode != 0 || status.FinishedAt == nil {
		t.Fatalf("outcome: %+v", status)
	}
	run := func(_ context.Context, args ...string) (string, error) {
		if args[1] == "show" {
			return "ActiveState=active\nSubState=waiting", nil
		}
		return `[{"unit":"ddclient.timer","last":1791100000000000,"next":1791100060000000}]`, nil
	}
	timer := readServiceTimer(context.Background(), run, "ddclient.timer")
	if timer == nil || timer.Active != "active" || timer.LastRunAt == nil || timer.NextRunAt == nil || *timer.LastRunAt == *timer.NextRunAt {
		t.Fatalf("timer: %+v", timer)
	}
	if timerTimestamp(0) != nil || timerTimestamp(math.MaxUint64) != nil {
		t.Fatal("unavailable deadline became a date")
	}
}

func TestDNSActionStartsTimerAndCheckWithoutRestart(t *testing.T) {
	for _, failing := range []string{"", "ddclient.timer", "ddclient.service"} {
		t.Run(failing, func(t *testing.T) {
			var calls []string
			run := func(_ context.Context, args ...string) (string, error) {
				calls = append(calls, strings.Join(args, " "))
				if args[2] == failing {
					return "", errors.New("check failed")
				}
				return "", nil
			}
			response := httptest.NewRecorder()
			newHandler(run, journal.Policy{}).ServeHTTP(response, httptest.NewRequest("POST", "/actions/restart-ddclient", strings.NewReader("{}")))
			want := []string{"systemctl start ddclient.timer", "systemctl start ddclient.service"}
			if failing == "ddclient.timer" {
				want = want[:1]
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("calls = %v", calls)
			}
			if failing == "" && response.Code != 200 || failing != "" && response.Code != 502 {
				t.Fatalf("status=%d %s", response.Code, response.Body.String())
			}
		})
	}
}
