// Package regado is Kerno's outbound adapter for the Regado agent and Prometheus.
package regado

// Queries and aggregates bounded Prometheus history independently of host actions
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const metricsTimeout = 8 * time.Second

// MetricsClient queries Prometheus for current and historical system metrics
type MetricsClient struct {
	client  *http.Client
	baseURL string
}

func NewMetricsClient(baseURL string) *MetricsClient {
	return &MetricsClient{
		client:  &http.Client{Timeout: metricsTimeout},
		baseURL: strings.TrimRight(baseURL, "/"),
	}
}

type sample struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

type rangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		Result []rangeSeries `json:"result"`
	} `json:"data"`
}

type rangeSeries struct {
	Values [][]json.RawMessage `json:"values"`
}

func (client *MetricsClient) series(ctx context.Context, query string, start, end int64, step int) ([]sample, error) {
	request, err := client.rangeRequest(ctx, query, start, end, step)
	if err != nil {
		return nil, err
	}
	response, err := client.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metrics query returned status %d", response.StatusCode)
	}
	return decodeRangeSamples(response.Body)
}

func (client *MetricsClient) rangeRequest(ctx context.Context, query string, start, end int64, step int) (*http.Request, error) {
	values := url.Values{}
	values.Set("query", query)
	values.Set("start", strconv.FormatInt(start, 10))
	values.Set("end", strconv.FormatInt(end, 10))
	values.Set("step", strconv.Itoa(step))
	endpoint := client.baseURL + "/api/v1/query_range?" + values.Encode()
	return http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
}

func decodeRangeSamples(body io.Reader) ([]sample, error) {
	data, err := readJSONResponse(body)
	if err != nil {
		return nil, err
	}
	var result rangeResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if result.Status != "success" {
		return nil, errors.New("metrics query failed")
	}
	if len(result.Data.Result) == 0 {
		return []sample{}, nil
	}
	return parseSamples(result.Data.Result[0].Values), nil
}

func parseSamples(values [][]json.RawMessage) []sample {
	points := make([]sample, 0, len(values))
	for _, pair := range values {
		point, valid := parseSample(pair)
		if valid {
			points = append(points, point)
		}
	}
	return points
}

func parseSample(pair []json.RawMessage) (sample, bool) {
	if len(pair) != 2 {
		return sample{}, false
	}

	var timestamp float64
	var rawValue string
	if json.Unmarshal(pair[0], &timestamp) != nil || json.Unmarshal(pair[1], &rawValue) != nil {
		return sample{}, false
	}
	value, err := strconv.ParseFloat(rawValue, 64)
	if err != nil || !isFinite(timestamp) || !isFinite(value) {
		return sample{}, false
	}
	return sample{Time: int64(timestamp), Value: value}, true
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

type historyWindow struct {
	period int64
	step   int
}

func selectHistoryWindow(window string) historyWindow {
	selected := historyWindow{period: 3600, step: 15}
	switch window {
	case "24h":
		selected = historyWindow{period: 86400, step: 300}
	case "7d":
		selected = historyWindow{period: 604800, step: 1800}
	}
	return selected
}

func historyQueries() map[string]string {
	return map[string]string{
		"cpuPercent":              `100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))`,
		"memoryPercent":           `100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`,
		"load1":                   `node_load1`,
		"diskReadBytesPerSecond":  `sum(rate(node_disk_read_bytes_total{device!~"loop.*|ram.*"}[2m]))`,
		"diskWriteBytesPerSecond": `sum(rate(node_disk_written_bytes_total{device!~"loop.*|ram.*"}[2m]))`,
		"networkBytesPerSecond":   `sum(rate(node_network_receive_bytes_total{device!="lo"}[2m]) + rate(node_network_transmit_bytes_total{device!="lo"}[2m]))`,
		"storagePercent":          `100 * (1 - sum(max by (device) (node_filesystem_avail_bytes{device!="",fstype!~"rootfs|tmpfs|overlay|squashfs"})) / sum(max by (device) (node_filesystem_size_bytes{device!="",fstype!~"rootfs|tmpfs|overlay|squashfs"})))`,
	}
}

func (client *MetricsClient) History(ctx context.Context, window string) (json.RawMessage, error) {
	selected := selectHistoryWindow(window)
	end := time.Now().Unix()
	start := end - selected.period
	series, err := client.historySeries(ctx, historyQueries(), start, end, selected.step)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"window": window, "series": series})
}

func (client *MetricsClient) historySeries(ctx context.Context, queries map[string]string, start, end int64, step int) (map[string][]sample, error) {
	queryCtx, cancel := context.WithTimeout(ctx, metricsTimeout)
	defer cancel()

	series := make(map[string][]sample, len(queries))
	var mutex sync.Mutex
	var pending sync.WaitGroup
	var firstError error

	for name, query := range queries {
		pending.Go(func() {
			points, err := client.series(queryCtx, query, start, end, step)
			mutex.Lock()
			defer mutex.Unlock()

			if err != nil {
				if firstError == nil {
					firstError = err
					cancel()
				}
				return
			}
			series[name] = points
		})
	}
	pending.Wait()
	if firstError != nil {
		return nil, firstError
	}
	return series, nil
}
