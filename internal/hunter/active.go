package hunter

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

type ActiveState struct {
	Active bool         `json:"active"`
	Sites  []SiteStatus `json:"sites"`
}

type SiteStatus struct {
	Site      model.Site `json:"site"`
	Running   bool       `json:"running"`
	Total     int        `json:"total"`
	Succeeded int        `json:"succeeded"`
	Failed    int        `json:"failed"`
	Error     string     `json:"error,omitempty"`
}

type siteScan struct {
	SiteStatus
	failed []jobKey
}

func (s *Service) ActiveState(ctx context.Context, owner string) (ActiveState, error) {
	active, err := s.db.ActiveMode(ctx, owner)
	if err != nil {
		return ActiveState{}, err
	}
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	return ActiveState{Active: active, Sites: s.scanStatuses(owner)}, nil
}

func (s *Service) SetActiveMode(ctx context.Context, owner string, active bool) error {
	return s.db.SetActiveMode(ctx, owner, active)
}

func (s *Service) ActiveProducts(ctx context.Context, owner string) ([]store.ActiveProduct, error) {
	return s.db.ActiveProducts(ctx, owner)
}

func (s *Service) MarkActiveProductsViewed(ctx context.Context, owner string, ids []uint64) error {
	return s.db.MarkActiveProductsViewed(ctx, owner, ids)
}

// AcceptPhoneSearch saves an authenticated account's on-device Surugaya results.
func (s *Service) AcceptPhoneSearch(ctx context.Context, owner, taskID string, page market.PhoneSearchPage) (int, error) {
	if taskID == "" || len(taskID) > 255 {
		return 0, problem.InvalidRequest
	}
	active, err := s.db.ActiveMode(ctx, owner)
	if err != nil {
		return 0, err
	}
	if !active {
		return 0, problem.ActiveModeOff
	}
	j := s.findJob(jobKey{model.Surugaya, taskID})
	if j == nil {
		return 0, problem.TaskNotFound
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.deleted {
		return 0, problem.TaskNotFound
	}
	w, err := s.db.Watcher(ctx, j.key.site, taskID)
	if err != nil {
		return 0, err
	}
	if w.Owner != owner {
		return 0, problem.TaskPermission
	}
	condition, err := model.ReadCondition(w.Site, w.Condition)
	if err != nil {
		return 0, problem.PhoneSearchMismatch
	}
	items, err := market.SurugayaPhoneItems(condition, page)
	if err != nil {
		return 0, problem.PhoneSearchMismatch
	}
	// Recheck active mode in the write transaction. Phone results go to the app only.
	if len(items) > 0 {
		pending, err := s.db.AcceptSearch(ctx, w, condition, items, false)
		if err != nil {
			return 0, err
		}
		if len(pending) > 0 {
			return 0, problem.ActiveModeOff
		}
	}
	return len(items), nil
}

// StartScan starts all search tasks, or only the failed tasks for the selected site.
func (s *Service) StartScan(ctx context.Context, owner string, site model.Site) (ActiveState, error) {
	if site != "" && (!site.Valid() || site == model.Surveillance) {
		return ActiveState{}, problem.InvalidRequest
	}
	active, err := s.db.ActiveMode(ctx, owner)
	if err != nil {
		return ActiveState{}, err
	}
	if !active {
		return ActiveState{}, problem.ActiveModeOff
	}
	if site != "" {
		return s.retrySite(owner, site), nil
	}
	watchers, err := s.db.Watchers(ctx, owner)
	if err != nil {
		return ActiveState{}, err
	}
	bySite := make(map[model.Site][]jobKey)
	for _, w := range watchers {
		if w.Site != model.Surveillance {
			bySite[w.Site] = append(bySite[w.Site], jobKey{w.Site, w.ID})
		}
	}
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	for _, scan := range s.scans[owner] {
		if scan.Running {
			return ActiveState{Active: true, Sites: s.scanStatuses(owner)}, nil
		}
	}
	scans := make(map[model.Site]*siteScan, len(bySite))
	s.scans[owner] = scans
	for site, keys := range bySite {
		scan := &siteScan{SiteStatus: SiteStatus{Site: site, Total: len(keys), Running: true}}
		scans[site] = scan
		go s.scanSite(keys, scan)
	}
	return ActiveState{Active: true, Sites: s.scanStatuses(owner)}, nil
}

func (s *Service) retrySite(owner string, site model.Site) ActiveState {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	if scan := s.scans[owner][site]; scan != nil && !scan.Running && len(scan.failed) > 0 {
		keys := scan.failed
		scan.Running, scan.failed, scan.Failed, scan.Error = true, nil, 0, ""
		go s.scanSite(keys, scan)
	}
	return ActiveState{Active: true, Sites: s.scanStatuses(owner)}
}

// scanStatuses requires scanMu and returns a copy for the caller.
func (s *Service) scanStatuses(owner string) []SiteStatus {
	statuses := make([]SiteStatus, 0, len(model.Sites))
	for _, site := range model.Sites {
		if scan := s.scans[owner][site]; scan != nil {
			statuses = append(statuses, scan.SiteStatus)
		}
	}
	return statuses
}

func (s *Service) scanSite(keys []jobKey, scan *siteScan) {
	defer func() {
		s.scanMu.Lock()
		scan.Running = false
		s.scanMu.Unlock()
	}()
	select {
	case s.scanSlots <- struct{}{}:
		defer func() { <-s.scanSlots }()
	case <-s.ctx.Done():
		return
	}
	for _, key := range keys {
		if s.ctx.Err() != nil {
			return
		}
		err := s.scanWatcher(key)
		s.scanMu.Lock()
		switch {
		case err == nil:
			scan.Succeeded++
		case errors.Is(err, problem.TaskNotFound):
			scan.Total--
		default:
			scan.Failed++
			scan.failed = append(scan.failed, key)
			reason := market.Labels[market.FailureOf(err)]
			if errors.Is(err, context.DeadlineExceeded) {
				reason = "本次搜索超时"
			}
			if scan.Error == "" {
				scan.Error = reason
			} else if !strings.Contains(scan.Error, reason) {
				scan.Error += "、" + reason
			}
		}
		s.scanMu.Unlock()
	}
}

func (s *Service) scanWatcher(key jobKey) error {
	j := s.findJob(key)
	if j == nil {
		return problem.TaskNotFound
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Minute)
	defer cancel()
	select {
	case j.slot <- struct{}{}:
		defer func() { <-j.slot }()
	case <-ctx.Done():
		return ctx.Err()
	}
	j.mu.Lock()
	generation := j.generation
	j.mu.Unlock()
	return s.runWatcher(ctx, j, generation, true)
}
