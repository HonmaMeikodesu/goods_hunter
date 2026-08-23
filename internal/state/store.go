// Package state provides concurrency-safe, atomic persistence for a single
// goods-hunter process. The file is compact JSON so backups and inspection stay
// simple, while all mutation details remain behind Store's methods.
package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

const schemaVersion = 1

type userRecord struct {
	Email        string    `json:"email"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type pendingRegistration struct {
	Code         string    `json:"code"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"passwordHash"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type sessionRecord struct {
	Token     string    `json:"token"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type diskState struct {
	Version              int                            `json:"version"`
	Users                map[string]userRecord          `json:"users"`
	PendingRegistrations map[string]pendingRegistration `json:"pendingRegistrations"`
	Sessions             map[string]sessionRecord       `json:"sessions"`
	Watchers             map[string]model.Watcher       `json:"watchers"`
	Seen                 map[string]map[string]int64    `json:"seen"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	data diskState
}

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("state file path is empty")
	}
	store := &Store{path: path, data: newDiskState()}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return store, nil
		}
		return nil, fmt.Errorf("read state file: %w", err)
	}
	if len(raw) == 0 {
		return store, nil
	}
	if err := json.Unmarshal(raw, &store.data); err != nil {
		return nil, fmt.Errorf("decode state file: %w", err)
	}
	if store.data.Version != schemaVersion {
		return nil, fmt.Errorf("unsupported state schema version %d", store.data.Version)
	}
	store.normalize()
	return store, nil
}

func newDiskState() diskState {
	return diskState{
		Version:              schemaVersion,
		Users:                make(map[string]userRecord),
		PendingRegistrations: make(map[string]pendingRegistration),
		Sessions:             make(map[string]sessionRecord),
		Watchers:             make(map[string]model.Watcher),
		Seen:                 make(map[string]map[string]int64),
	}
}

func (s *Store) normalize() {
	if s.data.Users == nil {
		s.data.Users = make(map[string]userRecord)
	}
	if s.data.PendingRegistrations == nil {
		s.data.PendingRegistrations = make(map[string]pendingRegistration)
	}
	if s.data.Sessions == nil {
		s.data.Sessions = make(map[string]sessionRecord)
	}
	if s.data.Watchers == nil {
		s.data.Watchers = make(map[string]model.Watcher)
	}
	if s.data.Seen == nil {
		s.data.Seen = make(map[string]map[string]int64)
	}
}

func CanonicalEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (s *Store) PutPendingRegistration(ctx context.Context, code, email, passwordHash string, expiresAt time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	email = CanonicalEmail(email)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commitLocked(func(next *diskState) {
		pruneExpired(next, time.Now())
		next.PendingRegistrations[code] = pendingRegistration{
			Code: code, Email: email, PasswordHash: passwordHash, ExpiresAt: expiresAt,
		}
	})
}

func (s *Store) DeletePendingRegistration(ctx context.Context, code string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commitLocked(func(next *diskState) {
		delete(next.PendingRegistrations, code)
	})
}

func (s *Store) ConfirmRegistration(ctx context.Context, code string, now time.Time) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pending, ok := s.data.PendingRegistrations[code]
	if !ok || !now.Before(pending.ExpiresAt) {
		return "", problem.ErrInvalidRegisterCode
	}
	if _, exists := s.data.Users[pending.Email]; exists {
		return "", problem.ErrUserAlreadyExists
	}
	if err := s.commitLocked(func(next *diskState) {
		next.Users[pending.Email] = userRecord{
			Email: pending.Email, PasswordHash: pending.PasswordHash, CreatedAt: now, UpdatedAt: now,
		}
		delete(next.PendingRegistrations, code)
	}); err != nil {
		return "", err
	}
	return pending.Email, nil
}

func (s *Store) UserPassword(ctx context.Context, email string) (string, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	user, ok := s.data.Users[CanonicalEmail(email)]
	return user.PasswordHash, ok, nil
}

func (s *Store) UpgradePassword(ctx context.Context, email, previousHash, nextHash string, now time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := CanonicalEmail(email)
	user, ok := s.data.Users[key]
	if !ok || user.PasswordHash != previousHash {
		return problem.ErrWrongCredentials
	}
	return s.commitLocked(func(next *diskState) {
		user.PasswordHash = nextHash
		user.UpdatedAt = now
		next.Users[key] = user
	})
}

func (s *Store) PutSession(ctx context.Context, token, email string, expiresAt time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commitLocked(func(next *diskState) {
		pruneExpired(next, time.Now())
		next.Sessions[token] = sessionRecord{Token: token, Email: CanonicalEmail(email), ExpiresAt: expiresAt}
	})
}

func (s *Store) SessionOwner(ctx context.Context, token string, now time.Time) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.data.Sessions[token]
	if !ok {
		return "", problem.ErrInvalidLoginState
	}
	if !now.Before(session.ExpiresAt) {
		return "", problem.ErrExpiredLoginState
	}
	if _, ok := s.data.Users[session.Email]; !ok {
		return "", problem.ErrInvalidLoginState
	}
	return session.Email, nil
}

func (s *Store) CreateWatcher(ctx context.Context, watcher model.Watcher) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Users[CanonicalEmail(watcher.UserEmail)]; !ok {
		return problem.ErrInvalidLoginState
	}
	if _, exists := s.data.Watchers[watcher.HunterInstanceID]; exists {
		return problem.ErrDuplicateTask
	}
	if watcher.Type == model.HunterSurveillance {
		for _, existing := range s.data.Watchers {
			if existing.Type == model.HunterSurveillance &&
				CanonicalEmail(existing.UserEmail) == CanonicalEmail(watcher.UserEmail) &&
				existing.SearchConditionSchema == watcher.SearchConditionSchema {
				return problem.ErrDuplicateTask
			}
		}
	}
	watcher.UserEmail = CanonicalEmail(watcher.UserEmail)
	return s.commitLocked(func(next *diskState) {
		next.Watchers[watcher.HunterInstanceID] = watcher
	})
}

func (s *Store) Watcher(ctx context.Context, id string) (model.Watcher, error) {
	if err := ctx.Err(); err != nil {
		return model.Watcher{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	watcher, ok := s.data.Watchers[id]
	if !ok {
		return model.Watcher{}, problem.ErrTaskNotFound
	}
	return watcher, nil
}

func (s *Store) AllWatchers(ctx context.Context) ([]model.Watcher, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]model.Watcher, 0, len(s.data.Watchers))
	for _, watcher := range s.data.Watchers {
		result = append(result, watcher)
	}
	sortWatchers(result)
	return result, nil
}

func (s *Store) ListWatchers(ctx context.Context, owner string) ([]model.Watcher, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	owner = CanonicalEmail(owner)
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]model.Watcher, 0)
	for _, watcher := range s.data.Watchers {
		if CanonicalEmail(watcher.UserEmail) == owner {
			result = append(result, watcher)
		}
	}
	sortWatchers(result)
	return result, nil
}

func sortWatchers(watchers []model.Watcher) {
	sort.Slice(watchers, func(i, j int) bool {
		if watchers[i].CreatedAt.Equal(watchers[j].CreatedAt) {
			return watchers[i].HunterInstanceID < watchers[j].HunterInstanceID
		}
		return watchers[i].CreatedAt.Before(watchers[j].CreatedAt)
	})
}

func (s *Store) UpdateWatcher(ctx context.Context, owner, id string, hunterType model.HunterType, schedule, freezeStart, freezeEnd, conditionSchema string, now time.Time) (model.Watcher, error) {
	if err := ctx.Err(); err != nil {
		return model.Watcher{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	watcher, ok := s.data.Watchers[id]
	if !ok || watcher.Type != hunterType {
		return model.Watcher{}, problem.ErrTaskNotFound
	}
	if CanonicalEmail(watcher.UserEmail) != CanonicalEmail(owner) {
		return model.Watcher{}, problem.ErrTaskPermission
	}
	conditionChanged := watcher.SearchConditionSchema != conditionSchema
	watcher.Schedule = schedule
	watcher.FreezingStart = freezeStart
	watcher.FreezingEnd = freezeEnd
	watcher.SearchConditionSchema = conditionSchema
	watcher.UpdatedAt = now
	if conditionChanged && watcher.Type == model.HunterSurveillance {
		watcher.Snapshot = ""
	}
	if err := s.commitLocked(func(next *diskState) {
		if conditionChanged {
			delete(next.Seen, id)
		}
		next.Watchers[id] = watcher
	}); err != nil {
		return model.Watcher{}, err
	}
	return watcher, nil
}

func (s *Store) DeleteWatcher(ctx context.Context, owner, id string, hunterType model.HunterType) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	watcher, ok := s.data.Watchers[id]
	if !ok || watcher.Type != hunterType {
		return problem.ErrTaskNotFound
	}
	if CanonicalEmail(watcher.UserEmail) != CanonicalEmail(owner) {
		return problem.ErrTaskPermission
	}
	return s.commitLocked(func(next *diskState) {
		delete(next.Watchers, id)
		delete(next.Seen, id)
	})
}

func (s *Store) DeleteWatcherSystem(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Watchers[id]; !ok {
		return problem.ErrTaskNotFound
	}
	return s.commitLocked(func(next *diskState) {
		delete(next.Watchers, id)
		delete(next.Seen, id)
	})
}

func (s *Store) UnseenItems(ctx context.Context, watcherID string, items []model.Item) ([]model.Item, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.data.Watchers[watcherID]; !ok {
		return nil, problem.ErrTaskNotFound
	}
	seen := s.data.Seen[watcherID]
	result := make([]model.Item, 0, len(items))
	for _, item := range items {
		if item.ID == "" {
			continue
		}
		if _, exists := seen[item.ID]; !exists {
			result = append(result, item)
		}
	}
	return result, nil
}

func (s *Store) MarkItemsSeen(ctx context.Context, watcherID string, items []model.Item, now time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Watchers[watcherID]; !ok {
		return problem.ErrTaskNotFound
	}
	return s.commitLocked(func(next *diskState) {
		if next.Seen[watcherID] == nil {
			next.Seen[watcherID] = make(map[string]int64)
		}
		for _, item := range items {
			if item.ID == "" {
				continue
			}
			next.Seen[watcherID][item.ID] = now.Unix()
		}
	})
}

func (s *Store) UpdateSnapshot(ctx context.Context, watcherID, snapshot string, now time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	watcher, ok := s.data.Watchers[watcherID]
	if !ok {
		return problem.ErrTaskNotFound
	}
	return s.commitLocked(func(next *diskState) {
		watcher.Snapshot = snapshot
		watcher.UpdatedAt = now
		next.Watchers[watcherID] = watcher
	})
}

func pruneExpired(data *diskState, now time.Time) {
	for code, pending := range data.PendingRegistrations {
		if !now.Before(pending.ExpiresAt) {
			delete(data.PendingRegistrations, code)
		}
	}
	for token, session := range data.Sessions {
		if !now.Before(session.ExpiresAt) {
			delete(data.Sessions, token)
		}
	}
}

func (s *Store) commitLocked(mutate func(*diskState)) error {
	next := cloneDiskState(s.data)
	mutate(&next)
	current := s.data
	s.data = next
	if err := s.writeLocked(); err != nil {
		s.data = current
		return err
	}
	return nil
}

func cloneDiskState(source diskState) diskState {
	result := newDiskState()
	for key, value := range source.Users {
		result.Users[key] = value
	}
	for key, value := range source.PendingRegistrations {
		result.PendingRegistrations[key] = value
	}
	for key, value := range source.Sessions {
		result.Sessions[key] = value
	}
	for key, value := range source.Watchers {
		result.Watchers[key] = value
	}
	for watcherID, records := range source.Seen {
		result.Seen[watcherID] = make(map[string]int64, len(records))
		for itemID, record := range records {
			result.Seen[watcherID][itemID] = record
		}
	}
	return result
}

func (s *Store) writeLocked() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".goods-hunter-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary state file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("protect temporary state file: %w", err)
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temporary state file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temporary state file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary state file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("replace state file: %w", err)
	}
	return nil
}
