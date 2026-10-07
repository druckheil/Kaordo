package regado

// Exercises bounded system responses, metrics parsing and cancellation
import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSystemResponsesRejectOversizeAndTrailingJSON(t *testing.T) {
	for _, input := range []string{strings.Repeat(" ", maxResponseSize-2) + "{}extra", `{"status":"success","data":{"result":[]}} {}`, "{"} {
		if _, err := readJSONResponse(strings.NewReader(input)); err == nil {
			t.Fatal("accepted invalid or truncated system response")
		}
		if _, err := decodeRangeSamples(strings.NewReader(input)); err == nil {
			t.Fatal("accepted invalid or truncated metrics response")
		}
	}
	if _, err := readJSONResponse(strings.NewReader(strings.Repeat(" ", maxResponseSize-2) + "{}")); err != nil {
		t.Fatal("exact response limit rejected", err)
	}
}

func TestMetricsFiltersNonFiniteSamples(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/query_range" || r.URL.Query().Get("step") != "15" {
			t.Errorf("unexpected metrics request: %s", r.URL)
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[100,"1.5"],[101,"NaN"],[102,"+Inf"],[103,"-Inf"],[104,"bad"],[105,"0"]]}]}}`))
	}))
	defer server.Close()
	client := NewMetricsClient(server.URL)
	points, err := client.series(context.Background(), "node_load1", 100, 105, 15)
	if err != nil || len(points) != 2 || points[0].Value != 1.5 || points[1].Value != 0 {
		t.Fatalf("samples = %+v, error %v", points, err)
	}
	raw, err := client.History(context.Background(), "1h")
	if err != nil || !json.Valid(raw) {
		t.Fatalf("history = %s, error %v", raw, err)
	}
	var history struct {
		Series map[string][]sample `json:"series"`
	}
	if err := json.Unmarshal(raw, &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Series) != 7 || len(history.Series["storagePercent"]) != 2 {
		t.Fatalf("history series = %+v", history.Series)
	}
}

func TestMetricsPropagatesFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	if _, err := NewMetricsClient(server.URL).History(context.Background(), "24h"); err == nil {
		t.Fatal("failed metrics were presented as available")
	}
}
