package hunter

import (
	"context"
	"encoding/json"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
)

type fakeSender struct {
	mu       sync.Mutex
	messages []model.Mail
}

func (s *fakeSender) Send(_ context.Context, message model.Mail) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, message)
	return nil
}

func (s *fakeSender) reset() {
	s.mu.Lock()
	s.messages = nil
	s.mu.Unlock()
}

func (s *fakeSender) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.messages)
}

type fakeMarketplace struct {
	mu        sync.Mutex
	items     []model.Item
	snapshots []model.Snapshot
	index     int
}

func (m *fakeMarketplace) Search(context.Context, model.Site, model.SearchCondition) ([]model.Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]model.Item(nil), m.items...), nil
}

func (m *fakeMarketplace) Snapshot(context.Context, model.Site, string) (model.Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.snapshots) == 0 {
		return model.Snapshot{Status: "invalid"}, nil
	}
	index := m.index
	if index >= len(m.snapshots) {
		index = len(m.snapshots) - 1
	}
	m.index++
	return m.snapshots[index], nil
}

func TestWatcherLifecycleDeduplicationAndSurveillance(t *testing.T) {
	store, err := state.Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	sender := &fakeSender{}
	seedUser(t, store, sender, "user@example.com")
	sender.reset()
	marketplace := &fakeMarketplace{items: []model.Item{{ID: "m1", Name: "first", Price: "100"}}}
	module := New(store, marketplace, sender, "https://hunter.example", nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := module.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stopCtx, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		_ = module.Stop(stopCtx)
	}()

	condition, _ := json.Marshal(model.SearchCondition{Keyword: "doll"})
	id, err := module.Hire(ctx, "user@example.com", HireInput{
		Type: model.HunterMercari, Schedule: "* * * * *", SearchCondition: condition,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := module.RunNow(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := module.RunNow(ctx, id); err != nil {
		t.Fatal(err)
	}
	if sender.count() != 1 {
		t.Fatalf("deduplicated mail count = %d, want 1", sender.count())
	}

	updatedCondition, _ := json.Marshal(model.SearchCondition{Keyword: "figure"})
	if err := module.Update(ctx, "user@example.com", UpdateInput{
		ID: id, Type: model.HunterMercari, Schedule: "*/5 * * * *", SearchCondition: updatedCondition,
	}); err != nil {
		t.Fatal(err)
	}
	if err := module.RunNow(ctx, id); err != nil {
		t.Fatal(err)
	}
	if sender.count() != 2 {
		t.Fatalf("mail count after condition reset = %d, want 2", sender.count())
	}
	if err := module.Delete(ctx, "other@example.com", id, model.HunterMercari); err != problem.ErrTaskPermission {
		t.Fatalf("foreign delete error = %v", err)
	}
	if err := module.Delete(ctx, "user@example.com", id, model.HunterMercari); err != nil {
		t.Fatal(err)
	}

	marketplace.snapshots = []model.Snapshot{
		{ID: "m2", Name: "watched", Price: "100", Status: "on_sale"},
		{ID: "m2", Name: "watched", Price: "80", Status: "on_sale"},
		{ID: "m2", Name: "watched", Price: "80", Status: "sold_out"},
	}
	marketplace.index = 0
	surveillanceCondition, _ := json.Marshal(model.SurveillanceCondition{Type: model.SiteMercari, GoodID: "m2"})
	surveillanceID, err := module.Hire(ctx, "user@example.com", HireInput{
		Type: model.HunterSurveillance, Schedule: "0 * * * *", SearchCondition: surveillanceCondition,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := module.RunNow(ctx, surveillanceID); err != nil {
		t.Fatal(err)
	}
	if err := module.RunNow(ctx, surveillanceID); err != nil {
		t.Fatal(err)
	}
	if sender.count() != 4 {
		t.Fatalf("mail count after surveillance changes = %d, want 4", sender.count())
	}
	if _, err := store.Watcher(ctx, surveillanceID); err != problem.ErrTaskNotFound {
		t.Fatalf("sold watcher still exists: %v", err)
	}
}

func seedUser(t *testing.T, store *state.Store, sender *fakeSender, email string) {
	t.Helper()
	module := accounts.New(store, sender, accounts.Options{
		BaseURL: "https://hunter.example", SystemOwner: "owner@example.com",
		RegistrationTTL: time.Hour, SessionTTL: time.Hour,
	})
	if err := module.Register(context.Background(), email, "secret"); err != nil {
		t.Fatal(err)
	}
	sender.mu.Lock()
	text := sender.messages[len(sender.messages)-1].Text
	sender.mu.Unlock()
	marker := "Accept registration: "
	parsed, err := url.Parse(strings.TrimSpace(text[strings.Index(text, marker)+len(marker):]))
	if err != nil {
		t.Fatal(err)
	}
	if err := module.Confirm(context.Background(), parsed.Query().Get("code")); err != nil {
		t.Fatal(err)
	}
}
