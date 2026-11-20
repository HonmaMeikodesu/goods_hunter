package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

type siteTables struct {
	watchers     string
	records      string
	foreignKey   string
	recordID     string
	recordFields string
	baseline     bool
	surveillance bool
}

var tables = map[model.Site]siteTables{
	model.Mercari: {
		watchers: "mercari_hunter", records: "mercari_goods_record", foreignKey: "hunterHunterInstanceId",
		recordID: "id", recordFields: "id,name,price",
	},
	model.Yahoo: {
		watchers: "yahoo_hunter", records: "yahoo_auction_record", foreignKey: "hunterHunterInstanceId",
		recordID: "auctionId", recordFields: "auctionId,auctionName,currentPrice,buyNowPrice,currentBidCount",
	},
	model.Surugaya: {
		watchers: "surugaya_hunter", records: "surugaya_goods_record", foreignKey: "hunterHunterInstanceId",
		recordID: "id", recordFields: "id,name,price,marketPlacePrice",
	},
	model.Mandarake: {
		watchers: "mandarake_hunter", records: "mandarake_goods_record", foreignKey: "hunterHunterInstanceId",
		recordID: "id", recordFields: "id,name,price",
	},
	model.YahooFleamarket: {
		watchers: "yahoo_fleamarket_hunter", records: "yahoo_fleamarket_goods_record", foreignKey: "hunterInstanceId",
		recordID: "id", recordFields: "id,name,price,thumbnailImageUrl,itemUrl,status,openTime,notificationPending",
		baseline: true,
	},
	model.Xianyu: {
		watchers: "xianyu_hunter", records: "xianyu_goods_record", foreignKey: "hunterInstanceId",
		recordID: "id", recordFields: "id,name,priceFen,thumbnailImageUrl,itemUrl,publishedAt,notificationPending",
		baseline: true,
	},
	model.Surveillance: {watchers: "surveillance_record", surveillance: true},
}

func (t siteTables) watcherSelect() string {
	initialized, snapshot := "0", "NULL"
	if t.baseline {
		initialized = "initialized"
	}
	if t.surveillance {
		snapshot = "snapshot"
	}
	return "SELECT hunterInstanceId,userEmail,schedule,freezingStart,freezingEnd,searchConditionSchema," +
		"createdAt,updatedAt," + initialized + "," + snapshot + " FROM " + t.watchers
}

func scanWatcher(site model.Site, row interface{ Scan(...any) error }) (model.Watcher, error) {
	w := model.Watcher{Site: site}
	err := row.Scan(&w.ID, &w.Owner, &w.Schedule, &w.FreezeStart, &w.FreezeEnd, &w.Condition,
		&w.CreatedAt, &w.UpdatedAt, &w.Initialized, &w.Snapshot)
	if errors.Is(err, sql.ErrNoRows) {
		return w, problem.TaskNotFound
	}
	return w, err
}

func (s *Store) Watchers(ctx context.Context, owner string) ([]model.Watcher, error) {
	list := make([]model.Watcher, 0)
	for _, site := range model.Sites {
		query := tables[site].watcherSelect()
		var args []any
		if owner != "" {
			query += " WHERE userEmail=?"
			args = append(args, owner)
		}
		rows, err := s.db.QueryContext(ctx, query+" ORDER BY createdAt,hunterInstanceId", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			watcher, err := scanWatcher(site, rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			list = append(list, watcher)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return list, nil
}

func (s *Store) Watcher(ctx context.Context, site model.Site, id string) (model.Watcher, error) {
	return scanWatcher(site, s.db.QueryRowContext(ctx, tables[site].watcherSelect()+" WHERE hunterInstanceId=?", id))
}

func lockWatcher(ctx context.Context, tx *sql.Tx, site model.Site, id string) (model.Watcher, error) {
	return scanWatcher(site, tx.QueryRowContext(ctx, tables[site].watcherSelect()+" WHERE hunterInstanceId=? FOR UPDATE", id))
}

func (s *Store) CreateWatcher(ctx context.Context, w model.Watcher) error {
	table := tables[w.Site]
	fields := "hunterInstanceId,userEmail,schedule,freezingStart,freezingEnd,searchConditionSchema"
	args := []any{w.ID, w.Owner, w.Schedule, w.FreezeStart, w.FreezeEnd, w.Condition}
	if !table.surveillance {
		_, err := s.db.ExecContext(ctx, "INSERT INTO "+table.watchers+" ("+fields+") VALUES ("+placeholders(len(args))+")", args...)
		return err
	}
	fields += ",snapshot"
	args = append(args, w.Snapshot)
	return s.transaction(ctx, func(tx *sql.Tx) error {
		// Serialize duplicate checks for concurrent registrations by the same user.
		if err := lockOwner(ctx, tx, w.Owner); err != nil {
			return err
		}
		if err := checkDetailDuplicate(ctx, tx, w); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO "+table.watchers+" ("+fields+") VALUES ("+placeholders(len(args))+")", args...)
		return err
	})
}

func lockOwner(ctx context.Context, tx *sql.Tx, email string) error {
	var owner string
	return tx.QueryRowContext(ctx, "SELECT email FROM `user` WHERE email=? FOR UPDATE", email).Scan(&owner)
}

func (s *Store) CheckDetailDuplicate(ctx context.Context, w model.Watcher) error {
	return checkDetailDuplicate(ctx, s.db, w)
}

func checkDetailDuplicate(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, w model.Watcher) error {
	var duplicate string
	err := db.QueryRowContext(ctx, "SELECT hunterInstanceId FROM surveillance_record"+
		" WHERE userEmail=? AND searchConditionSchema=? AND hunterInstanceId<>? LIMIT 1",
		w.Owner, w.Condition, w.ID).Scan(&duplicate)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return problem.DuplicateTask
}

func (s *Store) UpdateWatcher(ctx context.Context, w model.Watcher) error {
	t := tables[w.Site]
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if t.surveillance {
			if err := lockOwner(ctx, tx, w.Owner); err != nil {
				return err
			}
		}
		current, err := lockWatcher(ctx, tx, w.Site, w.ID)
		if err != nil {
			return err
		}
		if current.Owner != w.Owner {
			return problem.TaskPermission
		}
		before, _ := model.ReadCondition(w.Site, current.Condition)
		after, _ := model.ReadCondition(w.Site, w.Condition)
		set := "schedule=?,searchConditionSchema=?"
		args := []any{w.Schedule, w.Condition}
		if t.baseline || w.FreezeStart != nil {
			set += ",freezingStart=?,freezingEnd=?"
			args = append(args, w.FreezeStart, w.FreezeEnd)
		}
		keywordChanged := before.Keyword != after.Keyword
		conditionChanged := before.Schema != after.Schema
		if t.baseline && conditionChanged {
			set += ",initialized=0"
		}
		if t.surveillance && conditionChanged {
			if err := checkDetailDuplicate(ctx, tx, w); err != nil {
				return err
			}
			set += ",snapshot=NULL"
		}
		reset := (t.baseline && conditionChanged) || (!t.baseline && keywordChanged)
		if reset && t.records != "" {
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+t.records+" WHERE "+t.foreignKey+"=?", w.ID); err != nil {
				return err
			}
		}
		args = append(args, w.ID, w.Owner)
		_, err = tx.ExecContext(ctx, "UPDATE "+t.watchers+" SET "+set+" WHERE hunterInstanceId=? AND userEmail=?", args...)
		return err
	})
}

func (s *Store) DeleteWatcher(ctx context.Context, site model.Site, id, owner string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		current, err := lockWatcher(ctx, tx, site, id)
		if err != nil {
			return err
		}
		if current.Owner != owner {
			return problem.TaskPermission
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM "+tables[site].watchers+" WHERE hunterInstanceId=? AND userEmail=?", id, owner)
		return err
	})
}

func (s *Store) SaveSnapshot(ctx context.Context, w model.Watcher, snapshot string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE surveillance_record SET snapshot=? WHERE hunterInstanceId=? AND userEmail=?",
		snapshot, w.ID, w.Owner)
	return err
}
