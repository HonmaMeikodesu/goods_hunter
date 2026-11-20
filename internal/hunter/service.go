package hunter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

type Collector interface {
	Search(context.Context, model.Site, model.Condition) ([]model.Item, error)
	Snapshot(context.Context, model.Condition) (model.Snapshot, error)
	YahooHeartbeat(context.Context) string
}

type Service struct {
	ctx       context.Context
	db        *store.Store
	cache     *redis.Client
	collector Collector
	sender    notify.Sender
	logger    *slog.Logger
	cfg       config.Config
	cron      *cron.Cron
	queue     chan struct{}
	mu        sync.Mutex
	jobs      map[jobKey]*job
}

type jobKey struct {
	site model.Site
	id   string
}

type job struct {
	key        jobKey
	busy       atomic.Bool
	mu         sync.Mutex // Protects setup and finalization from concurrent edits.
	entry      cron.EntryID
	generation uint64
	deleted    bool
}

func New(ctx context.Context, cfg config.Config, db *store.Store, cache *redis.Client, collector Collector, sender notify.Sender, logger *slog.Logger) *Service {
	return &Service{
		ctx: ctx, cfg: cfg, db: db, cache: cache, collector: collector, sender: sender, logger: logger,
		cron: cron.New(cron.WithLocation(cfg.Location)),
		jobs: make(map[jobKey]*job), queue: make(chan struct{}, 1),
	}
}

func (s *Service) Restore(ctx context.Context) error {
	watchers, err := s.db.Watchers(ctx, "")
	if err != nil {
		return err
	}
	for _, w := range watchers {
		j := &job{key: jobKey{w.Site, w.ID}}
		s.jobs[j.key] = j
		schedule, err := parseSchedule(w.Schedule)
		if err != nil {
			s.logger.Warn("Saved watcher has an invalid schedule", "site", w.Site, "id", w.ID)
			continue
		}
		s.schedule(j, schedule)
	}
	if _, err := s.cron.AddFunc("0 * * * *", func() { s.checkYahoo(s.ctx) }); err != nil {
		return err
	}
	_, err = s.cron.AddFunc("0 22 * * *", func() { s.reportToday(s.ctx, time.Now()) })
	return err
}

func (s *Service) Start()                { s.cron.Start() }
func (s *Service) Stop() context.Context { return s.cron.Stop() }

func (s *Service) List(ctx context.Context, owner string) ([]model.Watcher, error) {
	return s.db.Watchers(ctx, owner)
}

func (s *Service) Register(ctx context.Context, w model.Watcher) error {
	schedule, condition, err := prepare(&w)
	if err != nil {
		return err
	}
	w.ID = model.NewID()
	if w.Site == model.Surveillance {
		if err := s.db.CheckDetailDuplicate(ctx, w); err != nil {
			return err
		}
		snapshot, err := s.collector.Snapshot(ctx, condition)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			snapshot = model.Snapshot{ID: condition.GoodID, Status: "invalid", Thumbnails: []string{}}
		}
		encoded, _ := json.Marshal(snapshot)
		raw := string(encoded)
		w.Snapshot = &raw
	}
	j := &job{key: jobKey{w.Site, w.ID}}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.db.CreateWatcher(ctx, w); err != nil {
		return err
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	s.jobs[j.key] = j
	s.schedule(j, schedule)
	return nil
}

func (s *Service) Update(ctx context.Context, w model.Watcher) error {
	schedule, _, err := prepare(&w)
	if err != nil {
		return err
	}
	if w.ID == "" {
		return problem.InvalidRequest
	}
	j := s.findJob(jobKey{w.Site, w.ID})
	if j == nil {
		return problem.TaskNotFound
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.deleted {
		return problem.TaskNotFound
	}
	if err := s.db.UpdateWatcher(ctx, w); err != nil {
		return err
	}
	s.schedule(j, schedule)
	return nil
}

func (s *Service) Delete(ctx context.Context, site model.Site, id, owner string) error {
	if id == "" || !site.Valid() {
		return problem.InvalidRequest
	}
	j := s.findJob(jobKey{site, id})
	if j == nil {
		return problem.TaskNotFound
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	return s.remove(ctx, j, owner)
}

func (s *Service) remove(ctx context.Context, j *job, owner string) error {
	if j.deleted {
		return problem.TaskNotFound
	}
	if err := s.db.DeleteWatcher(ctx, j.key.site, j.key.id, owner); err != nil {
		return err
	}
	s.cron.Remove(j.entry)
	j.deleted = true
	s.mu.Lock()
	delete(s.jobs, j.key)
	s.mu.Unlock()
	return nil
}

func (s *Service) findJob(key jobKey) *job {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jobs[key]
}

func (s *Service) schedule(j *job, schedule cron.Schedule) {
	if j.entry != 0 {
		s.cron.Remove(j.entry)
	}
	j.generation++
	generation := j.generation
	j.entry = s.cron.Schedule(schedule, cron.FuncJob(func() { s.run(s.ctx, j, generation) }))
}

func prepare(w *model.Watcher) (cron.Schedule, model.Condition, error) {
	if !w.Site.Valid() || w.Owner == "" || !validFreeze(w.FreezeStart, w.FreezeEnd) {
		return nil, model.Condition{}, problem.InvalidRequest
	}
	schedule, err := parseSchedule(w.Schedule)
	if err != nil {
		return nil, model.Condition{}, problem.InvalidRequest
	}
	condition, err := model.ReadCondition(w.Site, w.Condition)
	if err != nil || (w.Site == model.Surveillance && len(condition.Schema) > 255) {
		return nil, model.Condition{}, problem.InvalidRequest
	}
	w.Condition = condition.Schema
	return schedule, condition, nil
}

func parseSchedule(spec string) (cron.Schedule, error) {
	fields := strings.Fields(spec)
	if len(spec) > 255 || len(fields) != 5 || strings.ContainsAny(spec, "?@") {
		return nil, problem.InvalidRequest
	}
	schedule, err := cron.ParseStandard(strings.Join(fields, " "))
	if err != nil || schedule.Next(time.Now()).IsZero() {
		return nil, problem.InvalidRequest
	}
	return schedule, nil
}

func validFreeze(start, end *string) bool {
	if start == nil || end == nil {
		return start == nil && end == nil
	}
	_, startErr := time.Parse("15:04", *start)
	_, endErr := time.Parse("15:04", *end)
	return len(*start) == 5 && len(*end) == 5 && startErr == nil && endErr == nil
}

func frozen(w model.Watcher, now time.Time) bool {
	if w.FreezeStart == nil || w.FreezeEnd == nil || len(*w.FreezeStart) < 5 || len(*w.FreezeEnd) < 5 {
		return false
	}
	start, end := (*w.FreezeStart)[:5], (*w.FreezeEnd)[:5]
	clock := now.Format("15:04")
	if start > end {
		return clock >= start || clock < end
	}
	return clock >= start && clock < end
}

func (s *Service) run(ctx context.Context, j *job, generation uint64) {
	if ctx.Err() != nil || !j.busy.CompareAndSwap(false, true) {
		return
	}
	defer j.busy.Store(false)
	if j.key.site == model.Xianyu {
		select {
		case s.queue <- struct{}{}:
			defer func() { <-s.queue }()
		case <-ctx.Done():
			return
		}
	}
	j.mu.Lock()
	if j.deleted || generation != j.generation {
		j.mu.Unlock()
		return
	}
	w, err := s.db.Watcher(ctx, j.key.site, j.key.id)
	j.mu.Unlock()
	if err != nil {
		s.logWatcherError(j, err)
		return
	}
	if frozen(w, time.Now().In(s.cfg.Location)) {
		return
	}
	if w.Site == model.Surveillance {
		s.surveil(ctx, j, generation, w)
		return
	}
	condition, err := model.ReadCondition(w.Site, w.Condition)
	var items []model.Item
	if err != nil {
		err = market.InvalidRequest
	} else {
		items, err = s.collector.Search(ctx, w.Site, condition)
	}
	if ctx.Err() != nil {
		return
	}
	outcome := market.FailureOf(err)
	if recordErr := s.db.RecordScan(ctx, w.Site, string(outcome), time.Now()); recordErr != nil {
		s.logger.Error("Could not record search scan", "site", w.Site, "outcome", outcome, "error", recordErr)
	}
	if err != nil {
		s.logger.Warn("Search scan failed", "site", w.Site, "id", w.ID, "outcome", outcome)
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.deleted || generation != j.generation {
		return
	}
	if err := s.deliverSearch(ctx, w, condition, items); err != nil {
		s.logWatcherError(j, err)
	}
}

func (s *Service) deliverSearch(ctx context.Context, w model.Watcher, condition model.Condition, items []model.Item) error {
	pending, err := s.db.AcceptSearch(ctx, w, condition, items)
	if err != nil || len(pending) == 0 {
		return err
	}
	message, err := notify.SearchMessage(w, condition, pending, s.cfg.PublicURL)
	if err != nil {
		return err
	}
	if err := s.sender.Send(ctx, message); err != nil {
		return err
	}
	if err := s.db.AcknowledgeDelivery(ctx, w, pending); err != nil {
		return err
	}
	s.logger.Info("Search notification sent", "site", w.Site, "id", w.ID, "items", len(pending))
	return nil
}

func (s *Service) surveil(ctx context.Context, j *job, generation uint64, w model.Watcher) {
	condition, err := model.ReadCondition(w.Site, w.Condition)
	if err != nil {
		s.logWatcherError(j, err)
		return
	}
	next, err := s.collector.Snapshot(ctx, condition)
	if err != nil {
		s.logWatcherError(j, err)
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.deleted || generation != j.generation {
		return
	}
	if err := s.deliverSnapshot(ctx, j, w, condition, next); err != nil {
		s.logWatcherError(j, err)
	}
}

func (s *Service) deliverSnapshot(ctx context.Context, j *job, w model.Watcher, condition model.Condition, next model.Snapshot) error {
	var previous model.Snapshot
	if w.Snapshot != nil {
		_ = json.Unmarshal([]byte(*w.Snapshot), &previous)
	}
	sold := next.Status == "sold_out"
	if previous.Status == "" || previous.Status == "invalid" || previous.Price != next.Price || (sold && previous.Status != next.Status) {
		message, err := notify.SnapshotMessage(w, condition.DetailSite, previous, next, s.cfg.PublicURL)
		if err != nil {
			return err
		}
		if err := s.sender.Send(ctx, message); err != nil {
			return err
		}
		if !sold {
			encoded, _ := json.Marshal(next)
			return s.db.SaveSnapshot(ctx, w, string(encoded))
		}
	}
	if sold {
		return s.remove(ctx, j, w.Owner)
	}
	return nil
}

func (s *Service) logWatcherError(j *job, err error) {
	if errors.Is(err, context.Canceled) || errors.Is(err, problem.TaskNotFound) {
		return
	}
	s.logger.Error("Watcher failed", "site", j.key.site, "id", j.key.id, "error", err)
}
