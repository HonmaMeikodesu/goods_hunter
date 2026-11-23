package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

type ActiveProduct struct {
	ID      uint64
	Site    model.Site
	Item    model.Item
	FoundAt time.Time
}

func (s *Store) ActiveMode(ctx context.Context, owner string) (bool, error) {
	return activeMode(ctx, s.db, owner)
}

func activeMode(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner string) (bool, error) {
	var active bool
	err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM active_search_mode WHERE userEmail=?)", owner).Scan(&active)
	return active, err
}

func (s *Store) SetActiveMode(ctx context.Context, owner string, active bool) error {
	query := "DELETE FROM active_search_mode WHERE userEmail=?"
	if active {
		query = "INSERT INTO active_search_mode (userEmail) VALUES (?) ON DUPLICATE KEY UPDATE userEmail=userEmail"
	}
	_, err := s.db.ExecContext(ctx, query, owner)
	return err
}

func saveActiveProducts(ctx context.Context, tx *sql.Tx, w model.Watcher, items []model.Item) error {
	for _, item := range items {
		payload, err := json.Marshal(item)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO active_search_product (userEmail,site,itemId,item) VALUES (?,?,?,?)"+
			" ON DUPLICATE KEY UPDATE itemId=itemId", w.Owner, w.Site, item.ID, payload)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ActiveProducts(ctx context.Context, owner string) ([]ActiveProduct, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,site,item,foundAt FROM active_search_product"+
		" WHERE userEmail=? AND viewed=0 ORDER BY foundAt DESC,id DESC", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	products := make([]ActiveProduct, 0)
	for rows.Next() {
		var product ActiveProduct
		var payload []byte
		if err := rows.Scan(&product.ID, &product.Site, &payload, &product.FoundAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &product.Item); err != nil {
			return nil, err
		}
		products = append(products, product)
	}
	return products, rows.Err()
}

func (s *Store) MarkActiveProductsViewed(ctx context.Context, owner string, ids []uint64) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		const batchSize = 500
		for start := 0; start < len(ids); start += batchSize {
			batch := ids[start:min(len(ids), start+batchSize)]
			args := make([]any, 1, len(batch)+1)
			args[0] = owner
			for _, id := range batch {
				args = append(args, id)
			}
			if _, err := tx.ExecContext(ctx, "UPDATE active_search_product SET viewed=1"+
				" WHERE userEmail=? AND id IN ("+placeholders(len(batch))+")", args...); err != nil {
				return err
			}
		}
		return nil
	})
}
