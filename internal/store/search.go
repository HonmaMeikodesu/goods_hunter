package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

// AcceptSearch returns notifications after validating the current watcher. For
// baseline sites it also commits the first successful scan and the mail queue.
func (s *Store) AcceptSearch(ctx context.Context, w model.Watcher, search model.Condition, items []model.Item) ([]model.Item, error) {
	var pending []model.Item
	table := tables[w.Site]
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		current, err := lockWatcher(ctx, tx, w.Site, w.ID)
		if errors.Is(err, problem.TaskNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if current.Owner != w.Owner || current.Condition != w.Condition {
			return nil
		}
		seen, err := existingIDs(ctx, tx, table, w.ID, items)
		if err != nil {
			return err
		}
		if !table.baseline {
			for _, item := range items {
				if !seen[item.ID] {
					pending = append(pending, item)
				}
			}
			return nil
		}
		for _, item := range items {
			if seen[item.ID] {
				if w.Site == model.Xianyu && item.Image != "" {
					if _, err := tx.ExecContext(ctx, "UPDATE xianyu_goods_record SET thumbnailImageUrl=?"+
						" WHERE hunterInstanceId=? AND id=? AND thumbnailImageUrl=''", item.Image, w.ID, item.ID); err != nil {
						return err
					}
				}
				continue
			}
			if err := insertItem(ctx, tx, w, item, current.Initialized || search.NotifyExisting); err != nil {
				return err
			}
		}
		if !current.Initialized {
			if _, err := tx.ExecContext(ctx, "UPDATE "+table.watchers+" SET initialized=1 WHERE hunterInstanceId=?", w.ID); err != nil {
				return err
			}
		}
		pending, err = readPending(ctx, tx, w)
		return err
	})
	return pending, err
}

func existingIDs(ctx context.Context, tx *sql.Tx, table siteTables, watcherID string, items []model.Item) (map[string]bool, error) {
	seen := make(map[string]bool, len(items))
	const batchSize = 500
	for start := 0; start < len(items); start += batchSize {
		batch := items[start:min(len(items), start+batchSize)]
		args := make([]any, 1, len(batch)+1)
		args[0] = watcherID
		for _, item := range batch {
			args = append(args, item.ID)
		}
		rows, err := tx.QueryContext(ctx, "SELECT "+table.recordID+" FROM "+table.records+" WHERE "+table.foreignKey+
			"=? AND "+table.recordID+" IN ("+placeholders(len(batch))+")", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			seen[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return seen, nil
}

func insertItem(ctx context.Context, tx *sql.Tx, w model.Watcher, item model.Item, pending bool) error {
	table := tables[w.Site]
	args := []any{w.ID, item.ID, item.Name}
	switch w.Site {
	case model.Yahoo:
		args = append(args, item.Amount, item.BuyNow, item.BidCount)
	case model.YahooFleamarket:
		args = append(args, item.Amount, item.Image, item.URL, item.Status, item.PublishedAt, pending)
	case model.Xianyu:
		args = append(args, item.Amount, item.Image, item.URL, item.PublishedAt, pending)
	case model.Surugaya:
		args = append(args, nullable(item.Price), nullable(item.MarketPrice))
	default:
		args = append(args, nullable(item.Price))
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO "+table.records+" ("+table.foreignKey+","+table.recordFields+
		") VALUES ("+placeholders(len(args))+")", args...)
	return err
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func readPending(ctx context.Context, tx *sql.Tx, w model.Watcher) ([]model.Item, error) {
	query := "SELECT id,name,priceFen,thumbnailImageUrl,itemUrl,'' FROM xianyu_goods_record"
	if w.Site == model.YahooFleamarket {
		query = "SELECT id,name,price,thumbnailImageUrl,itemUrl,status FROM yahoo_fleamarket_goods_record"
	}
	rows, err := tx.QueryContext(ctx, query+" WHERE hunterInstanceId=? AND notificationPending=1 ORDER BY createdAt,id", w.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pending []model.Item
	for rows.Next() {
		var item model.Item
		if err := rows.Scan(&item.ID, &item.Name, &item.Amount, &item.Image, &item.URL, &item.Status); err != nil {
			return nil, err
		}
		pending = append(pending, item)
	}
	return pending, rows.Err()
}

// AcknowledgeDelivery is called only after SMTP accepts the notification.
func (s *Store) AcknowledgeDelivery(ctx context.Context, w model.Watcher, items []model.Item) error {
	if len(items) == 0 {
		return nil
	}
	table := tables[w.Site]
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if table.baseline {
			const batchSize = 500
			for start := 0; start < len(items); start += batchSize {
				batch := items[start:min(len(items), start+batchSize)]
				args := make([]any, 1, len(batch)+1)
				args[0] = w.ID
				for _, item := range batch {
					args = append(args, item.ID)
				}
				if _, err := tx.ExecContext(ctx, "UPDATE "+table.records+
					" SET notificationPending=0, notifiedAt=CURRENT_TIMESTAMP WHERE hunterInstanceId=? AND id IN ("+
					placeholders(len(batch))+")", args...); err != nil {
					return err
				}
			}
			return nil
		}
		for _, item := range items {
			if err := insertItem(ctx, tx, w, item, false); err != nil {
				return err
			}
		}
		return nil
	})
}

type ScanCount struct {
	Site    model.Site
	Outcome string
	Count   int
}

func (s *Store) RecordScan(ctx context.Context, site model.Site, outcome string, completedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO search_scan_record(site,outcome,completedAt) VALUES (?,?,?)", site, outcome, completedAt)
	return err
}

func (s *Store) ScanCounts(ctx context.Context, start, end time.Time) ([]ScanCount, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT site,outcome,COUNT(*) FROM search_scan_record"+
		" WHERE completedAt>=? AND completedAt<? GROUP BY site,outcome", start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var counts []ScanCount
	for rows.Next() {
		var count ScanCount
		if err := rows.Scan(&count.Site, &count.Outcome, &count.Count); err != nil {
			return nil, err
		}
		counts = append(counts, count)
	}
	return counts, rows.Err()
}
