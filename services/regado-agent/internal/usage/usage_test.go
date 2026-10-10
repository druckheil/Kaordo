package usage

// Verifies area walks, hard-link and boundary handling, history, growth and the fill projection
import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// pool answers btrfs like a two-disk RAID1 pool storing 7.5 GB of 1.9 TB
func pool(t *testing.T) func(context.Context, ...string) (string, error) {
	t.Helper()
	read := func(name string) string {
		raw, err := os.ReadFile(filepath.Join("..", "host", "testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	show, usage, stats := read("show.txt"), read("usage.txt"), read("stats.txt")
	return func(_ context.Context, args ...string) (string, error) {
		switch strings.Join(args[:3], " ") {
		case "btrfs filesystem show":
			return show, nil
		case "btrfs filesystem usage":
			return usage, nil
		default:
			return stats, nil
		}
	}
}

func write(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	// Random-looking content keeps every block allocated
	data := make([]byte, size)
	for index := range data {
		data[index] = byte(index*31 + 7)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestMeasureAttributesEveryFileOnceAndProjectsGrowth(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "media", "upload"), 64<<10)
	if err := os.Link(filepath.Join(root, "media", "upload"), filepath.Join(root, "media", "same-upload")); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "logs", "journal"), 32<<10)
	write(t, filepath.Join(root, "app", "secrets", "kerno.env"), 4<<10)
	write(t, filepath.Join(root, "app", "tmp", "scratch"), 16<<10)
	areas := []Area{
		{Key: "media", Paths: []string{filepath.Join(root, "media")}},
		{Key: "logs", Paths: []string{filepath.Join(root, "logs"), filepath.Join(root, "absent")}},
		{Key: "temporary", Paths: []string{filepath.Join(root, "app", "tmp")}},
		{Key: "other", Paths: []string{filepath.Join(root, "app")}, Exclude: []string{filepath.Join(root, "app", "tmp")}},
	}
	time0 := &clock{now: time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)}
	directory := t.TempDir()
	monitor, err := Open(directory, pool(t), "/srv/kaordo", areas, time0.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer monitor.Close()

	if report := monitor.Report(7 * day); report.MeasuredAt != nil || len(report.Categories) != 0 {
		t.Fatalf("report before a measurement = %+v", report)
	}
	if err := monitor.measure(context.Background()); err != nil {
		t.Fatal(err)
	}
	report := monitor.Report(7 * day)
	bytes := map[string]int64{}
	for _, category := range report.Categories {
		bytes[category.Key] = category.Bytes
		if category.GrowthDay != nil {
			t.Fatalf("growth without history: %+v", category)
		}
	}
	if bytes["media"] != 64<<10 {
		t.Fatalf("a hard link was counted twice: %d", bytes["media"])
	}
	if bytes["temporary"] != 16<<10 || bytes["other"] != 4<<10 || bytes["logs"] != 32<<10 {
		t.Fatalf("areas = %v", bytes)
	}
	// The fixture pool keeps 14 008 320 bytes of metadata and 16 384 of system data; the stored
	// bytes no measured file explains are reported rather than hidden
	files := int64(64<<10 + 32<<10 + 4<<10 + 16<<10)
	if bytes["metadata"] != 14008320+16384 || bytes["unreferenced"] != 7505887232-files-bytes["metadata"] || len(report.Categories) != 6 {
		t.Fatalf("filesystem share = %v", bytes)
	}
	// 15 011 774 464 raw bytes at a data ratio of 2 are 7 505 887 232 stored once
	if report.Pool.Stored != 7505887232 || report.Pool.Free != 948171849728 || report.FullInDays != nil {
		t.Fatalf("pool = %+v, full in %v", report.Pool, report.FullInDays)
	}

	// A week later the logs grew; the next measurement reports it and projects the fill date
	time0.advance(7 * day)
	write(t, filepath.Join(root, "logs", "runaway"), 256<<10)
	if err := monitor.measure(context.Background()); err != nil {
		t.Fatal(err)
	}
	report = monitor.Report(30 * day)
	for _, category := range report.Categories {
		if category.Key == "logs" && (category.GrowthWeek == nil || *category.GrowthWeek < 256<<10) {
			t.Fatalf("log growth = %+v", category)
		}
		if category.Key == "media" && (category.GrowthDay == nil || *category.GrowthDay != 0) {
			t.Fatalf("media growth = %+v", category)
		}
	}
	if len(report.History) != 2 || report.FullInDays != nil {
		t.Fatalf("history %d, full in %v (stored did not change)", len(report.History), report.FullInDays)
	}
	if len(monitor.Report(time.Hour).History) != 1 {
		t.Fatal("the window did not limit the history")
	}
	// A category an earlier sample did not measure has no growth rather than all of it
	delete(monitor.history[0].Bytes, "metadata")
	for _, category := range monitor.Report(30 * day).Categories {
		if category.Key == "metadata" && category.GrowthWeek != nil {
			t.Fatalf("metadata growth without an earlier measurement = %d", *category.GrowthWeek)
		}
	}

	reopened, err := Open(directory, pool(t), "/srv/kaordo", areas, time0.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.history) != 2 {
		t.Fatalf("history after restart = %d samples", len(reopened.history))
	}
}

func TestFullInDaysFollowsTheWeeklyGrowthOfStoredData(t *testing.T) {
	monitor := &Monitor{areas: []Area{{Key: "media"}}, pool: Pool{Stored: 300, Free: 700}}
	week := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	monitor.history = []Sample{{At: week, Stored: 230}, {At: week.Add(7 * day), Stored: 300}}
	monitor.latest = &monitor.history[1]
	report := monitor.Report(30 * day)
	// 70 bytes a week is 10 a day; 700 free bytes last 70 days
	if report.FullInDays == nil || *report.FullInDays != 70 {
		t.Fatalf("full in %v", report.FullInDays)
	}
}

func TestMeasureRequestsAreCoalescedWhileOneRuns(t *testing.T) {
	monitor := &Monitor{trigger: make(chan struct{}, 1)}
	first, second := monitor.Measure(), monitor.Measure()
	if !first || !second || len(monitor.trigger) != 1 {
		t.Fatal("pending requests were not coalesced")
	}
	monitor.measuring = true
	if monitor.Measure() {
		t.Fatal("a request was accepted during a measurement")
	}
}
