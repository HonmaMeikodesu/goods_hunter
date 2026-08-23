// Package schedule implements the five-field cron subset used by goods-hunter
// and an in-process scheduler with per-watcher overlap protection.
package schedule

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type field struct {
	allowed  []bool
	wildcard bool
	min      int
	max      int
}

type Expression struct {
	minute     field
	hour       field
	dayOfMonth field
	month      field
	dayOfWeek  field
}

func Parse(spec string) (Expression, error) {
	parts := strings.Fields(spec)
	if len(parts) != 5 {
		return Expression{}, fmt.Errorf("cron expression must have five fields")
	}
	minute, err := parseField(parts[0], 0, 59, false)
	if err != nil {
		return Expression{}, fmt.Errorf("minute: %w", err)
	}
	hour, err := parseField(parts[1], 0, 23, false)
	if err != nil {
		return Expression{}, fmt.Errorf("hour: %w", err)
	}
	dayOfMonth, err := parseField(parts[2], 1, 31, false)
	if err != nil {
		return Expression{}, fmt.Errorf("day of month: %w", err)
	}
	month, err := parseField(parts[3], 1, 12, false)
	if err != nil {
		return Expression{}, fmt.Errorf("month: %w", err)
	}
	dayOfWeek, err := parseField(parts[4], 0, 7, true)
	if err != nil {
		return Expression{}, fmt.Errorf("day of week: %w", err)
	}
	return Expression{minute: minute, hour: hour, dayOfMonth: dayOfMonth, month: month, dayOfWeek: dayOfWeek}, nil
}

func Valid(spec string) bool {
	_, err := Parse(spec)
	return err == nil
}

func (e Expression) Match(value time.Time) bool {
	if !e.minute.allowed[value.Minute()] || !e.hour.allowed[value.Hour()] || !e.month.allowed[int(value.Month())] {
		return false
	}
	domMatches := e.dayOfMonth.allowed[value.Day()]
	dowMatches := e.dayOfWeek.allowed[int(value.Weekday())]
	dayMatches := domMatches && dowMatches
	if !e.dayOfMonth.wildcard && !e.dayOfWeek.wildcard {
		dayMatches = domMatches || dowMatches
	}
	return dayMatches
}

func parseField(raw string, min, max int, normalizeSunday bool) (field, error) {
	result := field{allowed: make([]bool, max+1), wildcard: raw == "*", min: min, max: max}
	if raw == "" {
		return field{}, errors.New("field is empty")
	}
	for _, part := range strings.Split(raw, ",") {
		if part == "" {
			return field{}, errors.New("empty list entry")
		}
		base := part
		step := 1
		if strings.Contains(part, "/") {
			pieces := strings.Split(part, "/")
			if len(pieces) != 2 || pieces[0] == "" || pieces[1] == "" {
				return field{}, fmt.Errorf("invalid step %q", part)
			}
			base = pieces[0]
			parsed, err := strconv.Atoi(pieces[1])
			if err != nil || parsed <= 0 {
				return field{}, fmt.Errorf("invalid step %q", pieces[1])
			}
			step = parsed
		}
		start, end := min, max
		switch {
		case base == "*":
		case strings.Contains(base, "-"):
			bounds := strings.Split(base, "-")
			if len(bounds) != 2 {
				return field{}, fmt.Errorf("invalid range %q", base)
			}
			var err error
			start, err = strconv.Atoi(bounds[0])
			if err != nil {
				return field{}, fmt.Errorf("invalid value %q", bounds[0])
			}
			end, err = strconv.Atoi(bounds[1])
			if err != nil {
				return field{}, fmt.Errorf("invalid value %q", bounds[1])
			}
		default:
			parsed, err := strconv.Atoi(base)
			if err != nil {
				return field{}, fmt.Errorf("invalid value %q", base)
			}
			start, end = parsed, parsed
		}
		if start < min || end > max || start > end {
			return field{}, fmt.Errorf("range %d-%d is outside %d-%d", start, end, min, max)
		}
		for value := start; value <= end; value += step {
			normalized := value
			if normalizeSunday && value == 7 {
				normalized = 0
			}
			result.allowed[normalized] = true
		}
	}
	return result, nil
}

type Job func(context.Context) error

type entry struct {
	spec       string
	expression Expression
	job        Job
	running    bool
}

type Manager struct {
	mu      sync.Mutex
	entries map[string]*entry
	logger  *slog.Logger
	zone    *time.Location
	cancel  context.CancelFunc
	done    chan struct{}
	jobs    sync.WaitGroup
}

func NewManager(logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{entries: make(map[string]*entry), logger: logger, zone: time.FixedZone("Asia/Shanghai", 8*60*60)}
}

func (m *Manager) Add(id, spec string, job Job) error {
	if id == "" || job == nil {
		return errors.New("schedule id and job are required")
	}
	expression, err := Parse(spec)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.entries[id]; exists {
		return fmt.Errorf("schedule %s already exists", id)
	}
	m.entries[id] = &entry{spec: spec, expression: expression, job: job}
	return nil
}

func (m *Manager) Replace(id, spec string, job Job) error {
	expression, err := Parse(spec)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, exists := m.entries[id]
	if !exists {
		return fmt.Errorf("schedule %s not found", id)
	}
	if job == nil {
		job = current.job
	}
	m.entries[id] = &entry{spec: spec, expression: expression, job: job, running: current.running}
	return nil
}

func (m *Manager) Remove(id string) {
	m.mu.Lock()
	delete(m.entries, id)
	m.mu.Unlock()
}

func (m *Manager) IDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]string, 0, len(m.entries))
	for id := range m.entries {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func (m *Manager) Start(parent context.Context) {
	m.mu.Lock()
	if m.cancel != nil {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	m.cancel = cancel
	m.done = make(chan struct{})
	done := m.done
	m.mu.Unlock()
	go m.loop(ctx, done)
}

func (m *Manager) loop(ctx context.Context, done chan struct{}) {
	defer close(done)
	for {
		now := time.Now()
		next := now.Truncate(time.Minute).Add(time.Minute)
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case tick := <-timer.C:
			m.fire(ctx, tick.In(m.zone))
		}
	}
}

func (m *Manager) fire(ctx context.Context, now time.Time) {
	type readyJob struct {
		id  string
		job Job
	}
	m.mu.Lock()
	ready := make([]readyJob, 0)
	for id, scheduled := range m.entries {
		if !scheduled.running && scheduled.expression.Match(now) {
			scheduled.running = true
			ready = append(ready, readyJob{id: id, job: scheduled.job})
		}
	}
	m.mu.Unlock()
	for _, item := range ready {
		m.jobs.Add(1)
		go m.execute(ctx, item.id, item.job)
	}
}

func (m *Manager) execute(ctx context.Context, id string, job Job) {
	defer m.jobs.Done()
	defer func() {
		if recovered := recover(); recovered != nil {
			m.logger.Error("scheduled watcher panicked", "id", id, "panic", recovered, "stack", string(debug.Stack()))
		}
		m.mu.Lock()
		if scheduled, ok := m.entries[id]; ok {
			scheduled.running = false
		}
		m.mu.Unlock()
	}()
	if err := job(ctx); err != nil {
		m.logger.Error("scheduled watcher failed", "id", id, "error", err)
	}
}

func (m *Manager) RunNow(ctx context.Context, id string) error {
	m.mu.Lock()
	scheduled, ok := m.entries[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("schedule %s not found", id)
	}
	if scheduled.running {
		m.mu.Unlock()
		return fmt.Errorf("schedule %s is already running", id)
	}
	scheduled.running = true
	job := scheduled.job
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		if current, exists := m.entries[id]; exists {
			current.running = false
		}
		m.mu.Unlock()
	}()
	return job(ctx)
}

func (m *Manager) Stop(ctx context.Context) error {
	m.mu.Lock()
	cancel := m.cancel
	done := m.done
	m.cancel = nil
	m.done = nil
	m.mu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	jobsDone := make(chan struct{})
	go func() {
		m.jobs.Wait()
		close(jobsDone)
	}()
	select {
	case <-jobsDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
