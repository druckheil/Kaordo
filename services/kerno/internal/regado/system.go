package regado

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

type SystemClient struct{ client *http.Client }

func NewSystemClient(socket string) *SystemClient {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", socket)
	}}
	return &SystemClient{client: &http.Client{Transport: transport, Timeout: 35 * time.Second}}
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
	bytes, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if !json.Valid(bytes) {
		return nil, errors.New("invalid system agent response")
	}
	return bytes, nil
}

func (client *SystemClient) Snapshot(ctx context.Context) (json.RawMessage, error) {
	return client.request(ctx, http.MethodGet, "/snapshot")
}

func (client *SystemClient) Logs(ctx context.Context, service string) (json.RawMessage, error) {
	return client.request(ctx, http.MethodGet, "/logs?service="+url.QueryEscape(service))
}

func (client *SystemClient) Action(ctx context.Context, action string) (json.RawMessage, error) {
	return client.request(ctx, http.MethodPost, "/actions/"+url.PathEscape(action))
}

type MetricsClient struct {
	client  *http.Client
	baseURL string
}

func NewMetricsClient(baseURL string) *MetricsClient {
	return &MetricsClient{client: &http.Client{Timeout: 8 * time.Second}, baseURL: strings.TrimRight(baseURL, "/")}
}

type sample struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

func (client *MetricsClient) series(ctx context.Context, query string, start, end int64, step int) ([]sample, error) {
	values := url.Values{}
	values.Set("query", query)
	values.Set("start", strconv.FormatInt(start, 10))
	values.Set("end", strconv.FormatInt(end, 10))
	values.Set("step", strconv.Itoa(step))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/api/v1/query_range?"+values.Encode(), nil)
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
	var result struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Values [][]json.RawMessage `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil {
		return nil, err
	}
	if result.Status != "success" {
		return nil, errors.New("Prometheus query failed")
	}
	points := make([]sample, 0)
	if len(result.Data.Result) == 0 {
		return points, nil
	}
	for _, pair := range result.Data.Result[0].Values {
		if len(pair) != 2 {
			continue
		}
		var timestamp float64
		var rawValue string
		if json.Unmarshal(pair[0], &timestamp) != nil || json.Unmarshal(pair[1], &rawValue) != nil {
			continue
		}
		value, err := strconv.ParseFloat(rawValue, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || math.IsNaN(timestamp) || math.IsInf(timestamp, 0) {
			continue
		}
		points = append(points, sample{Time: int64(timestamp), Value: value})
	}
	return points, nil
}

func (client *MetricsClient) History(ctx context.Context, window string) (json.RawMessage, error) {
	period, step := int64(3600), 15
	switch window {
	case "24h":
		period, step = 86400, 300
	case "7d":
		period, step = 604800, 1800
	}
	end := time.Now().Unix()
	queries := map[string]string{
		"cpuPercent":              `100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))`,
		"memoryPercent":           `100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`,
		"load1":                   `node_load1`,
		"diskReadBytesPerSecond":  `sum(rate(node_disk_read_bytes_total{device!~"loop.*|ram.*"}[2m]))`,
		"diskWriteBytesPerSecond": `sum(rate(node_disk_written_bytes_total{device!~"loop.*|ram.*"}[2m]))`,
		"networkBytesPerSecond":   `sum(rate(node_network_receive_bytes_total{device!="lo"}[2m]) + rate(node_network_transmit_bytes_total{device!="lo"}[2m]))`,
		"storagePercent":          `100 * (1 - node_filesystem_avail_bytes{mountpoint="/srv/kaordo",fstype="btrfs"} / node_filesystem_size_bytes{mountpoint="/srv/kaordo",fstype="btrfs"})`,
	}
	series := make(map[string][]sample, len(queries))
	queryCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var mu sync.Mutex
	var pending sync.WaitGroup
	var firstError error
	for name, query := range queries {
		pending.Go(func() {
			points, err := client.series(queryCtx, query, end-period, end, step)
			mu.Lock()
			defer mu.Unlock()
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
	return json.Marshal(map[string]any{"window": window, "series": series})
}
