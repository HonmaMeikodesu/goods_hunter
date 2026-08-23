// Package hunter owns the complete watcher lifecycle: validation, persistence,
// scheduling, marketplace checks, de-duplication, and notifications.
package hunter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/schedule"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
)

type Marketplace interface {
	Search(context.Context, model.Site, model.SearchCondition) ([]model.Item, error)
	Snapshot(context.Context, model.Site, string) (model.Snapshot, error)
}

type Sender interface {
	Send(context.Context, model.Mail) error
}

type HireInput struct {
	Type            model.HunterType
	Schedule        string
	FreezeStart     string
	FreezeEnd       string
	SearchCondition json.RawMessage
}

type UpdateInput struct {
	ID              string
	Type            model.HunterType
	Schedule        string
	FreezeStart     string
	FreezeEnd       string
	SearchCondition json.RawMessage
}

type Module struct {
	store       *state.Store
	marketplace Marketplace
	sender      Sender
	scheduler   *schedule.Manager
	logger      *slog.Logger
	baseURL     string
	now         func() time.Time
}

func New(store *state.Store, marketplace Marketplace, sender Sender, baseURL string, logger *slog.Logger) *Module {
	if logger == nil {
		logger = slog.Default()
	}
	return &Module{
		store: store, marketplace: marketplace, sender: sender,
		scheduler: schedule.NewManager(logger), logger: logger,
		baseURL: strings.TrimRight(baseURL, "/"), now: time.Now,
	}
}

func (m *Module) Start(ctx context.Context) error {
	watchers, err := m.store.AllWatchers(ctx)
	if err != nil {
		return err
	}
	for _, watcher := range watchers {
		watcher := watcher
		m.scheduler.Remove(watcher.HunterInstanceID)
		if err := m.scheduler.Add(watcher.HunterInstanceID, watcher.Schedule, func(jobContext context.Context) error {
			return m.run(jobContext, watcher.HunterInstanceID)
		}); err != nil {
			return fmt.Errorf("restore watcher %s: %w", watcher.HunterInstanceID, err)
		}
	}
	m.scheduler.Start(ctx)
	m.logger.Info("all hunters standing by", "count", len(watchers))
	return nil
}

func (m *Module) Stop(ctx context.Context) error {
	return m.scheduler.Stop(ctx)
}

func (m *Module) Hire(ctx context.Context, owner string, input HireInput) (string, error) {
	conditionSchema, err := validateInput(input.Type, input.Schedule, input.FreezeStart, input.FreezeEnd, input.SearchCondition)
	if err != nil {
		return "", err
	}
	id, err := randomID()
	if err != nil {
		return "", err
	}
	now := m.now()
	watcher := model.Watcher{
		HunterInstanceID: id, UserEmail: state.CanonicalEmail(owner), Type: input.Type,
		FreezingStart: input.FreezeStart, FreezingEnd: input.FreezeEnd,
		Schedule: input.Schedule, SearchConditionSchema: conditionSchema,
		CreatedAt: now, UpdatedAt: now,
	}
	if input.Type == model.HunterSurveillance {
		condition, _ := watcher.SurveillanceCondition()
		snapshot, snapshotErr := m.marketplace.Snapshot(ctx, condition.Type, condition.GoodID)
		if snapshotErr != nil {
			m.logger.Warn("initial item snapshot failed", "marketplace", condition.Type, "item", condition.GoodID, "error", snapshotErr)
			snapshot = model.Snapshot{ID: condition.GoodID, Status: "invalid"}
		}
		raw, marshalErr := json.Marshal(snapshot)
		if marshalErr != nil {
			return "", marshalErr
		}
		watcher.Snapshot = string(raw)
	}
	if err := m.store.CreateWatcher(ctx, watcher); err != nil {
		return "", err
	}
	if err := m.scheduler.Add(id, input.Schedule, func(jobContext context.Context) error {
		return m.run(jobContext, id)
	}); err != nil {
		_ = m.store.DeleteWatcherSystem(context.WithoutCancel(ctx), id)
		return "", fmt.Errorf("schedule watcher: %w", err)
	}
	return id, nil
}

func (m *Module) Update(ctx context.Context, owner string, input UpdateInput) error {
	if strings.TrimSpace(input.ID) == "" {
		return problem.ErrInvalidRequest
	}
	conditionSchema, err := validateInput(input.Type, input.Schedule, input.FreezeStart, input.FreezeEnd, input.SearchCondition)
	if err != nil {
		return err
	}
	watcher, err := m.store.UpdateWatcher(ctx, owner, input.ID, input.Type, input.Schedule, input.FreezeStart, input.FreezeEnd, conditionSchema, m.now())
	if err != nil {
		return err
	}
	if input.Type == model.HunterSurveillance && watcher.Snapshot == "" {
		condition, _ := watcher.SurveillanceCondition()
		if snapshot, snapshotErr := m.marketplace.Snapshot(ctx, condition.Type, condition.GoodID); snapshotErr == nil {
			if raw, marshalErr := json.Marshal(snapshot); marshalErr == nil {
				_ = m.store.UpdateSnapshot(ctx, input.ID, string(raw), m.now())
			}
		} else {
			m.logger.Warn("updated item snapshot failed", "id", input.ID, "error", snapshotErr)
		}
	}
	if err := m.scheduler.Replace(input.ID, input.Schedule, nil); err != nil {
		if addErr := m.scheduler.Add(input.ID, input.Schedule, func(jobContext context.Context) error {
			return m.run(jobContext, input.ID)
		}); addErr != nil {
			return problem.ErrScheduleNotFound
		}
	}
	return nil
}

func (m *Module) Delete(ctx context.Context, owner, id string, hunterType model.HunterType) error {
	if strings.TrimSpace(id) == "" || !hunterType.Valid() {
		return problem.ErrInvalidRequest
	}
	if err := m.store.DeleteWatcher(ctx, owner, id, hunterType); err != nil {
		return err
	}
	m.scheduler.Remove(id)
	return nil
}

func (m *Module) List(ctx context.Context, owner string) ([]model.Watcher, error) {
	return m.store.ListWatchers(ctx, owner)
}

func (m *Module) RunNow(ctx context.Context, id string) error {
	return m.scheduler.RunNow(ctx, id)
}

func (m *Module) run(parent context.Context, id string) error {
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	watcher, err := m.store.Watcher(ctx, id)
	if err != nil {
		if err == problem.ErrTaskNotFound {
			m.scheduler.Remove(id)
			return nil
		}
		return err
	}
	if inFreezingRange(m.now(), watcher.FreezingStart, watcher.FreezingEnd) {
		m.logger.Info("watcher is inside its freezing range", "id", id)
		return nil
	}
	if watcher.Type == model.HunterSurveillance {
		return m.runSurveillance(ctx, watcher)
	}
	return m.runSearch(ctx, watcher)
}

func (m *Module) runSearch(ctx context.Context, watcher model.Watcher) error {
	condition, err := watcher.SearchCondition()
	if err != nil || strings.TrimSpace(condition.Keyword) == "" {
		return fmt.Errorf("watcher %s has invalid search condition", watcher.HunterInstanceID)
	}
	items, err := m.marketplace.Search(ctx, model.SiteForHunter(watcher.Type), condition)
	if err != nil {
		return fmt.Errorf("fetch %s items: %w", watcher.Type, err)
	}
	unseen, err := m.store.UnseenItems(ctx, watcher.HunterInstanceID, items)
	if err != nil {
		return err
	}
	if len(unseen) == 0 {
		return nil
	}
	htmlBody, textBody, err := renderItemList(watcher.Type, unseen, m.baseURL)
	if err != nil {
		return err
	}
	message := model.Mail{
		To:      watcher.UserEmail,
		Subject: fmt.Sprintf("New %s goods for keyword: %s", watcher.Type, condition.Keyword),
		HTML:    htmlBody, Text: textBody,
	}
	if err := m.sender.Send(ctx, message); err != nil {
		return fmt.Errorf("send watcher notification: %w", err)
	}
	if err := m.store.MarkItemsSeen(ctx, watcher.HunterInstanceID, unseen, m.now()); err != nil {
		return err
	}
	m.logger.Info("watcher notification sent", "id", watcher.HunterInstanceID, "to", watcher.UserEmail, "items", len(unseen))
	return nil
}

func (m *Module) runSurveillance(ctx context.Context, watcher model.Watcher) error {
	condition, err := watcher.SurveillanceCondition()
	if err != nil || !condition.Type.Valid() || strings.TrimSpace(condition.GoodID) == "" {
		return fmt.Errorf("watcher %s has invalid surveillance condition", watcher.HunterInstanceID)
	}
	latest, err := m.marketplace.Snapshot(ctx, condition.Type, condition.GoodID)
	if err != nil {
		return fmt.Errorf("fetch item snapshot: %w", err)
	}
	if latest.Status == "invalid" {
		m.logger.Warn("marketplace returned an invalid item snapshot", "id", watcher.HunterInstanceID)
		return nil
	}
	var previous model.Snapshot
	_ = json.Unmarshal([]byte(watcher.Snapshot), &previous)
	changed := watcher.Snapshot == "" || latest.Price != previous.Price || (latest.Status == "sold_out" && latest.Status != previous.Status)
	if changed {
		htmlBody, textBody, renderErr := renderSnapshot(condition.Type, latest, previous, watcher.HunterInstanceID, m.baseURL)
		if renderErr != nil {
			return renderErr
		}
		if err := m.sender.Send(ctx, model.Mail{
			To: watcher.UserEmail, Subject: fmt.Sprintf("%s item: %s", condition.Type, latest.Name), HTML: htmlBody, Text: textBody,
		}); err != nil {
			return fmt.Errorf("send surveillance notification: %w", err)
		}
	}
	if latest.Status == "sold_out" {
		if err := m.store.DeleteWatcherSystem(ctx, watcher.HunterInstanceID); err != nil && err != problem.ErrTaskNotFound {
			return err
		}
		m.scheduler.Remove(watcher.HunterInstanceID)
		m.logger.Info("sold item watcher removed", "id", watcher.HunterInstanceID, "item", condition.GoodID)
		return nil
	}
	if changed {
		raw, marshalErr := json.Marshal(latest)
		if marshalErr != nil {
			return marshalErr
		}
		if err := m.store.UpdateSnapshot(ctx, watcher.HunterInstanceID, string(raw), m.now()); err != nil {
			return err
		}
	}
	return nil
}

func validateInput(hunterType model.HunterType, cronSpec, freezeStart, freezeEnd string, raw json.RawMessage) (string, error) {
	if !hunterType.Valid() || !schedule.Valid(cronSpec) || !validFreezingRange(freezeStart, freezeEnd) || len(raw) == 0 {
		return "", problem.ErrInvalidRequest
	}
	if hunterType == model.HunterSurveillance {
		var condition model.SurveillanceCondition
		if err := json.Unmarshal(raw, &condition); err != nil || !condition.Type.Valid() || strings.TrimSpace(condition.GoodID) == "" || len(condition.GoodID) > 2048 {
			return "", problem.ErrInvalidRequest
		}
		condition.GoodID = strings.TrimSpace(condition.GoodID)
		canonical, _ := json.Marshal(condition)
		return string(canonical), nil
	}
	var condition model.SearchCondition
	if err := json.Unmarshal(raw, &condition); err != nil || strings.TrimSpace(condition.Keyword) == "" || len(condition.Keyword) > 500 {
		return "", problem.ErrInvalidRequest
	}
	condition.Keyword = strings.TrimSpace(condition.Keyword)
	canonical, _ := json.Marshal(condition)
	return string(canonical), nil
}

func validFreezingRange(start, end string) bool {
	if start == "" && end == "" {
		return true
	}
	if start == "" || end == "" {
		return false
	}
	_, startOK := clockMinutes(start)
	_, endOK := clockMinutes(end)
	return startOK && endOK
}

func inFreezingRange(now time.Time, start, end string) bool {
	startMinute, startOK := clockMinutes(start)
	endMinute, endOK := clockMinutes(end)
	if !startOK || !endOK || startMinute == endMinute {
		return false
	}
	zoneNow := now.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	current := zoneNow.Hour()*60 + zoneNow.Minute()
	if startMinute < endMinute {
		return current >= startMinute && current < endMinute
	}
	return current >= startMinute || current < endMinute
}

func clockMinutes(value string) (int, bool) {
	parsed, err := time.Parse("15:04", value)
	if err != nil || len(value) != 5 {
		return 0, false
	}
	return parsed.Hour()*60 + parsed.Minute(), true
}

func randomID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}
