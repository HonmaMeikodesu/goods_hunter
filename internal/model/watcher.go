package model

import (
	"crypto/rand"
	"fmt"
	"time"
)

type Site string

const (
	Mercari         Site = "Mercari"
	Yahoo           Site = "Yahoo"
	Surugaya        Site = "Surugaya"
	Mandarake       Site = "Mandarake"
	Surveillance    Site = "Surveillance"
	YahooFleamarket Site = "YahooFleamarket"
	Xianyu          Site = "Xianyu"
)

var Sites = [...]Site{Mercari, Yahoo, Surugaya, Mandarake, Surveillance, YahooFleamarket, Xianyu}

func (s Site) Valid() bool {
	for _, site := range Sites {
		if s == site {
			return true
		}
	}
	return false
}

func (s Site) UsesBaseline() bool {
	return s == Xianyu || s == YahooFleamarket
}

type Watcher struct {
	Site        Site
	ID          string
	Owner       string
	Schedule    string
	FreezeStart *string
	FreezeEnd   *string
	Condition   string
	Snapshot    *string
	Initialized bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Item struct {
	ID          string
	Name        string
	URL         string
	Image       string
	Price       string
	MarketPrice string
	Amount      int64
	BuyNow      *int64
	BidCount    *int64
	Status      string
	PublishedAt *string
}

type Snapshot struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Price      string   `json:"price"`
	Status     string   `json:"status"`
	Thumbnails []string `json:"thumbnails"`
}

// NewID keeps UUIDs compatible with existing task links and session records.
func NewID() string {
	var id [16]byte
	rand.Read(id[:])
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
}
