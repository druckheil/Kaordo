package state

// Persists the current document and its revision history with optimistic concurrency
import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
)

const (
	currentName = "current.json"
	historyDir  = "history"
	keepHistory = 50
)

var (
	ErrConflict = errors.New("the desired state changed since it was read")
	ErrNotFound = errors.New("no desired state has been recorded")
)

type Store struct {
	mu   sync.Mutex
	root *os.Root
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory+"/"+historyDir, 0o700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (store *Store) Close() { _ = store.root.Close() }

// Current returns the applied document, or ErrNotFound before the first write.
func (store *Store) Current() (Document, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.read(currentName)
}

// Revision returns a document from history.
func (store *Store) Revision(revision int64) (Document, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.read(historyDir + "/" + strconv.FormatInt(revision, 10) + ".json")
}

// Revisions lists the retained revision numbers, newest first.
func (store *Store) Revisions() ([]int64, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.revisions()
}

// Put validates and stores next when the current revision equals next.Revision.
// It returns the stored document with its new revision and the document it replaced.
func (store *Store) Put(next Document) (Document, *Document, error) {
	if err := next.Validate(); err != nil {
		return Document{}, nil, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	current, err := store.read(currentName)
	var previous *Document
	switch {
	case errors.Is(err, ErrNotFound):
		if next.Revision != 0 {
			return Document{}, nil, ErrConflict
		}
	case err != nil:
		return Document{}, nil, err
	case current.Revision != next.Revision:
		return Document{}, nil, ErrConflict
	default:
		previous = &current
	}
	next.Revision++
	if err := store.write(historyDir+"/"+strconv.FormatInt(next.Revision, 10)+".json", next); err != nil {
		return Document{}, nil, err
	}
	if err := store.write(currentName, next); err != nil {
		return Document{}, nil, err
	}
	return next, previous, store.prune()
}

func (store *Store) read(name string) (Document, error) {
	data, err := store.root.ReadFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return Document{}, ErrNotFound
	}
	if err != nil {
		return Document{}, err
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		return Document{}, fmt.Errorf("read %s: %w", name, err)
	}
	return document, nil
}

func (store *Store) write(name string, document Document) error {
	data, err := json.MarshalIndent(document, "", "\t")
	if err != nil {
		return err
	}
	temporary := name + ".tmp-" + rand.Text()
	if err := store.root.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := store.root.Rename(temporary, name); err != nil {
		_ = store.root.Remove(temporary)
		return err
	}
	return nil
}

func (store *Store) revisions() ([]int64, error) {
	entries, err := fs.ReadDir(store.root.FS(), historyDir)
	if err != nil {
		return nil, err
	}
	revisions := make([]int64, 0, len(entries))
	for _, entry := range entries {
		name, ok := strings.CutSuffix(entry.Name(), ".json")
		if revision, err := strconv.ParseInt(name, 10, 64); ok && err == nil {
			revisions = append(revisions, revision)
		}
	}
	slices.Sort(revisions)
	slices.Reverse(revisions)
	return revisions, nil
}

func (store *Store) prune() error {
	revisions, err := store.revisions()
	if err != nil || len(revisions) <= keepHistory {
		return err
	}
	for _, revision := range revisions[keepHistory:] {
		if err := store.root.Remove(historyDir + "/" + strconv.FormatInt(revision, 10) + ".json"); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}
