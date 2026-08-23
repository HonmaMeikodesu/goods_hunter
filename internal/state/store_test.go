package state

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFailedAtomicWriteRollsBackMemory(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	store, err := Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(root, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("block"), 0o600); err != nil {
		t.Fatal(err)
	}
	store.path = filepath.Join(blocker, "state.json")
	if err := store.PutPendingRegistration(context.Background(), "code", "user@example.com", "hash", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("PutPendingRegistration() unexpectedly succeeded")
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	if len(store.data.PendingRegistrations) != 0 {
		t.Fatalf("failed write changed in-memory state: %#v", store.data.PendingRegistrations)
	}
}
