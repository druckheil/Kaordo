package regado

// Reads system-agent snapshots and Prometheus history
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	systemAgentTimeout = 35 * time.Second
	metricsTimeout     = 8 * time.Second
	maxResponseSize    = 2 << 20
)

// SystemClient reads snapshots, logs, and actions through the local agent socket
type SystemClient struct {
	client *http.Client
}

func NewSystemClient(socket string) *SystemClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", socket)
		},
	}
	return &SystemClient{
		client: &http.Client{Transport: transport, Timeout: systemAgentTimeout},
	}
}

func (client *SystemClient) request(ctx context.Context, method, path string) (json.RawMessage, error) {
	request, err := http.NewRequestWithContext(ctx, method, "http://regado-agent"+path, nil)
	if err != nil {
		return nil, err
	}

	response, err := client.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("system agent returned %d", response.StatusCode)
	}
	return readJSONResponse(response.Body)
}

func readJSONResponse(body io.Reader) (json.RawMessage, error) {
	data, err := io.ReadAll(io.LimitReader(body, maxResponseSize))
	if err != nil {
		return nil, err
	}
	if !json.Valid(data) {
		return nil, errors.New("invalid system agent response")
	}
	return data, nil
}

func (client *SystemClient) Snapshot(ctx context.Context) (json.RawMessage, error) {
	return client.request(ctx, http.MethodGet, "/snapshot")
}

func (client *SystemClient) Logs(ctx context.Context, service string) (json.RawMessage, error) {
	path := "/logs?service=" + url.QueryEscape(service)
	return client.request(ctx, http.MethodGet, path)
}

func (client *SystemClient) Action(ctx context.Context, action string) (json.RawMessage, error) {
	path := "/actions/" + url.PathEscape(action)
	return client.request(ctx, http.MethodPost, path)
}

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
		return nil, fmt.Errorf("Prometheus returned %d", response.StatusCode)
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
	var result rangeResponse
	if err := json.NewDecoder(io.LimitReader(body, maxResponseSize)).Decode(&result); err != nil {
		return nil, err
	}
	if result.Status != "success" {
		return nil, errors.New("Prometheus query failed")
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
		"storagePercent":          `100 * (1 - node_filesystem_avail_bytes{mountpoint="/srv/kaordo",fstype="btrfs"} / node_filesystem_size_bytes{mountpoint="/srv/kaordo",fstype="btrfs"})`,
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
