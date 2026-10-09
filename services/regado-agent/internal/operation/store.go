package operation

// Persists operation records atomically inside the agent's state directory and applies retention
import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	keepRecords = 500
	keepFor     = 180 * 24 * time.Hour
	recordExt   = ".json"
)

type store struct {
	root *os.Root
}

func openStore(directory string) (*store, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return &store{root: root}, nil
}

func (store *store) close() error { return store.root.Close() }

// save writes through a temporary file so a crash never leaves a truncated record
func (store *store) save(record Record) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	temporary := record.ID + ".tmp-" + rand.Text()
	if err := store.root.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := store.root.Rename(temporary, record.ID+recordExt); err != nil {
		_ = store.root.Remove(temporary)
		return err
	}
	return nil
}

func (store *store) load(id string) (Record, error) {
	if uuid.Validate(id) != nil {
		return Record{}, ErrNotFound
	}
	data, err := store.root.ReadFile(id + recordExt)
	if errors.Is(err, fs.ErrNotExist) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return Record{}, err
	}
	return record, nil
}

// ids lists stored operations newest first; UUIDv7 names sort by creation time
func (store *store) ids() ([]string, error) {
	entries, err := fs.ReadDir(store.root.FS(), ".")
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		id, ok := strings.CutSuffix(entry.Name(), recordExt)
		if ok && entry.Type().IsRegular() && uuid.Validate(id) == nil {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	slices.Reverse(ids)
	return ids, nil
}

// prune keeps the newest records and drops finished ones beyond the age limit, plus stale temporaries
func (store *store) prune(now time.Time, active func(string) bool) error {
	ids, err := store.ids()
	if err != nil {
		return err
	}
	for index, id := range ids {
		if active(id) {
			continue
		}
		created, err := createdAt(id)
		if index >= keepRecords || (err == nil && now.Sub(created) > keepFor) {
			if err := store.root.Remove(id + recordExt); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
		}
	}
	entries, err := fs.ReadDir(store.root.FS(), ".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			_ = store.root.Remove(entry.Name())
		}
	}
	return nil
}

func createdAt(id string) (time.Time, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return time.Time{}, err
	}
	seconds, nanoseconds := parsed.Time().UnixTime()
	return time.Unix(seconds, nanoseconds), nil
}
