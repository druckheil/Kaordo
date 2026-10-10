// Package usage measures what fills the host's storage and keeps a history of it.
package usage

// Walks fixed areas of the host on a schedule, records each measurement and projects growth
import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
)

// Area is one named part of the host; its paths are walked within their own filesystem.
type Area struct {
	Key     string
	Paths   []string
	Exclude []string
}

// Areas describes the Kaordo host layout around the pool mounted at mount.
func Areas(mount string) []Area {
	app := func(names ...string) []string {
		paths := make([]string, len(names))
		for index, name := range names {
			paths[index] = filepath.Join(mount, name)
		}
		return paths
	}
	return []Area{
		{Key: "system", Paths: []string{"/"}, Exclude: []string{"/tmp", "/var/tmp"}},
		{Key: "nix", Paths: []string{"/nix"}},
		{Key: "logs", Paths: []string{"/var/log"}},
		{Key: "database", Paths: app("postgresql")},
		{Key: "media", Paths: app("media")},
		{Key: "metrics", Paths: app("prometheus")},
		{Key: "releases", Paths: app("releases", "rollbacks", "www", "bin")},
		{Key: "temporary", Paths: append([]string{"/tmp", "/var/tmp"}, app("tmp")...)},
		{Key: "other", Paths: []string{mount}, Exclude: app("postgresql", "media", "prometheus", "releases", "rollbacks", "www", "bin", "tmp")},
	}
}

type Category struct {
	Key   string `json:"key"`
	Bytes int64  `json:"bytes"`
	Files int64  `json:"files"`
	// Growth compares with the newest measurement at least a day or a week older; nil without one
	GrowthDay  *int64 `json:"growthDay"`
	GrowthWeek *int64 `json:"growthWeek"`
}

// Pool is the pool's usable space as users experience it: one copy of each stored byte.
type Pool struct {
	Stored int64 `json:"stored"`
	Free   int64 `json:"free"`
	// Saved is what shared blocks and compression save when files add up to more than is stored
	Saved int64 `json:"saved"`
}

// The filesystem's own share: its metadata, and blocks it keeps that no current file uses,
// such as parts of files rewritten in place
const (
	metadataKey     = "metadata"
	unreferencedKey = "unreferenced"
)

type Sample struct {
	At     time.Time        `json:"at"`
	Stored int64            `json:"stored"`
	Bytes  map[string]int64 `json:"bytes"`
}

type Report struct {
	MeasuredAt *time.Time `json:"measuredAt"`
	Measuring  bool       `json:"measuring"`
	Pool       Pool       `json:"pool"`
	Categories []Category `json:"categories"`
	History    []Sample   `json:"history"`
	// FullInDays projects the last week's growth onto the free space; nil when nothing grows
	FullInDays *float64 `json:"fullInDays"`
}

const (
	historyFile = "history.json"
	keepSamples = 24 * 92
	day         = 24 * time.Hour
)

type Monitor struct {
	run   command.Runner
	mount string
	areas []Area
	now   func() time.Time

	root      *os.Root
	trigger   chan struct{}
	mu        sync.Mutex
	measuring bool
	latest    *Sample
	files     map[string]int64
	pool      Pool
	history   []Sample
}

// Open loads the measurement history kept in directory for the pool mounted at mount.
func Open(directory string, run command.Runner, mount string, areas []Area, now func() time.Time) (*Monitor, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	monitor := &Monitor{run: run, mount: mount, areas: areas, now: now, root: root, trigger: make(chan struct{}, 1)}
	raw, err := root.ReadFile(historyFile)
	if err == nil {
		err = json.Unmarshal(raw, &monitor.history)
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		_ = root.Close()
		return nil, err
	}
	return monitor, nil
}

func (monitor *Monitor) Close() { _ = monitor.root.Close() }

// Watch measures at once, then every interval or when Measure asks for it, until ctx ends.
func (monitor *Monitor) Watch(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		if err := monitor.measure(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("storage usage measurement failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-monitor.trigger:
		}
	}
}

// Measure asks the watcher for a measurement now; it reports false while one is running.
func (monitor *Monitor) Measure() bool {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if monitor.measuring {
		return false
	}
	select {
	case monitor.trigger <- struct{}{}:
	default:
	}
	return true
}

func (monitor *Monitor) measure(ctx context.Context) error {
	monitor.mu.Lock()
	monitor.measuring = true
	monitor.mu.Unlock()
	defer func() {
		monitor.mu.Lock()
		monitor.measuring = false
		monitor.mu.Unlock()
	}()
	sample := Sample{Bytes: map[string]int64{}}
	files := map[string]int64{}
	// Hard-linked files count once across every area, as the pool stores them once
	seen := map[inode]bool{}
	for _, area := range monitor.areas {
		var bytes, count int64
		for _, path := range area.Paths {
			b, c, err := walk(ctx, path, area.Exclude, seen)
			if err != nil {
				return err
			}
			bytes, count = bytes+b, count+c
		}
		sample.Bytes[area.Key], files[area.Key] = bytes, count
	}
	pool, err := host.ReadPool(ctx, monitor.run, monitor.mount, nil)
	if err != nil {
		return err
	}
	ratio := pool.DataRatio
	if ratio <= 0 {
		ratio = 1
	}
	current := Pool{Stored: int64(float64(pool.Used) / ratio), Free: max(0, pool.FreeEstimated)}
	var measured int64
	for _, bytes := range sample.Bytes {
		measured += bytes
	}
	remainder := current.Stored - measured - pool.MetadataUsed
	sample.Bytes[metadataKey], sample.Bytes[unreferencedKey] = pool.MetadataUsed, max(0, remainder)
	current.Saved = max(0, -remainder)
	sample.At, sample.Stored = monitor.now().UTC(), current.Stored

	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	monitor.latest, monitor.files, monitor.pool = &sample, files, current
	monitor.history = append(monitor.history, sample)
	if len(monitor.history) > keepSamples {
		monitor.history = monitor.history[len(monitor.history)-keepSamples:]
	}
	raw, err := json.Marshal(monitor.history)
	if err != nil {
		return err
	}
	if err := monitor.root.WriteFile(historyFile+".tmp", raw, 0o600); err != nil {
		return err
	}
	return monitor.root.Rename(historyFile+".tmp", historyFile)
}

type inode struct{ dev, ino uint64 }

// walk sums file sizes under root without leaving its filesystem; Btrfs subvolumes are
// separate filesystems here, so each area measures only its own. Vanished or unreadable
// entries are skipped: a live host changes while it is measured.
func walk(ctx context.Context, root string, exclude []string, seen map[inode]bool) (bytes, files int64, err error) {
	info, err := os.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	stat, ok := statOf(info, nil)
	if !ok {
		return 0, 0, errors.New("the filesystem does not report device numbers")
	}
	counter := &counter{ctx: ctx, root: root, exclude: exclude, seen: seen, device: deviceOf(stat)}
	err = filepath.WalkDir(root, counter.visit)
	return counter.bytes, counter.files, err
}

type counter struct {
	ctx          context.Context
	root         string
	exclude      []string
	seen         map[inode]bool
	device       uint64
	bytes, files int64
}

func (counter *counter) visit(path string, entry fs.DirEntry, walkErr error) error {
	if err := counter.ctx.Err(); err != nil {
		return err
	}
	if walkErr != nil || path != counter.root && slices.Contains(counter.exclude, path) {
		return counter.skip(path, entry)
	}
	info, err := entry.Info()
	stat, ok := statOf(info, err)
	if !ok {
		return counter.skip(path, entry)
	}
	if deviceOf(stat) != counter.device {
		return counter.skip(path, entry)
	}
	if !entry.IsDir() && stat.Nlink > 1 {
		key := inode{counter.device, stat.Ino}
		if counter.seen[key] {
			return nil
		}
		counter.seen[key] = true
	}
	// File sizes, not allocated blocks: Btrfs keeps small files inline in metadata, where a
	// block count would round each one up to a whole block
	if info.Mode().IsRegular() {
		counter.bytes += info.Size()
		counter.files++
	}
	return nil
}

// skip leaves out an entry, and a whole directory below the root, that cannot or must not be counted
func (counter *counter) skip(path string, entry fs.DirEntry) error {
	if entry != nil && entry.IsDir() && path != counter.root {
		return fs.SkipDir
	}
	return nil
}

func deviceOf(stat *syscall.Stat_t) uint64 {
	return uint64(stat.Dev) //nolint:gosec,unconvert // device numbers are non-negative; Dev is narrower on some platforms
}

func statOf(info fs.FileInfo, err error) (*syscall.Stat_t, bool) {
	if err != nil {
		return nil, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return stat, ok
}

// Report returns the latest measurement with growth and the history inside window.
func (monitor *Monitor) Report(window time.Duration) Report {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := Report{Measuring: monitor.measuring, Categories: []Category{}, History: []Sample{}}
	if monitor.latest == nil {
		return report
	}
	latest := *monitor.latest
	report.MeasuredAt, report.Pool = &latest.At, monitor.pool
	dayAgo, weekAgo := monitor.before(latest.At.Add(-day)), monitor.before(latest.At.Add(-7*day))
	keys := make([]string, 0, len(monitor.areas)+2)
	for _, area := range monitor.areas {
		keys = append(keys, area.Key)
	}
	for _, key := range append(keys, metadataKey, unreferencedKey) {
		category := Category{Key: key, Bytes: latest.Bytes[key], Files: monitor.files[key]}
		category.GrowthDay, category.GrowthWeek = growth(dayAgo, key, category.Bytes), growth(weekAgo, key, category.Bytes)
		report.Categories = append(report.Categories, category)
	}
	if weekAgo != nil {
		perDay := float64(latest.Stored-weekAgo.Stored) / latest.At.Sub(weekAgo.At).Hours() * 24
		if perDay > 0 {
			days := float64(monitor.pool.Free) / perDay
			report.FullInDays = &days
		}
	}
	for _, sample := range monitor.history {
		if !sample.At.Before(latest.At.Add(-window)) {
			report.History = append(report.History, sample)
		}
	}
	return report
}

// growth compares with an earlier sample; a category that sample did not measure has none
func growth(earlier *Sample, key string, bytes int64) *int64 {
	if earlier == nil {
		return nil
	}
	before, measured := earlier.Bytes[key]
	if !measured {
		return nil
	}
	change := bytes - before
	return &change
}

// before finds the newest sample taken at or before at
func (monitor *Monitor) before(at time.Time) *Sample {
	for index := len(monitor.history) - 1; index >= 0; index-- {
		if !monitor.history[index].At.After(at) {
			return &monitor.history[index]
		}
	}
	return nil
}
