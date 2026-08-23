// Package model contains the persisted domain values shared by the modules.
package model

import (
	"encoding/json"
	"strings"
	"time"
)

type HunterType string

const (
	HunterMercari      HunterType = "Mercari"
	HunterYahoo        HunterType = "Yahoo"
	HunterSurugaya     HunterType = "Surugaya"
	HunterSurveillance HunterType = "Surveillance"
	HunterMandarake    HunterType = "Mandarake"
)

func (t HunterType) Valid() bool {
	switch t {
	case HunterMercari, HunterYahoo, HunterSurugaya, HunterSurveillance, HunterMandarake:
		return true
	default:
		return false
	}
}

type Site string

const (
	SiteMercari   Site = "mercari"
	SiteYahoo     Site = "yahoo"
	SiteSurugaya  Site = "surugaya"
	SiteMandarake Site = "mandarake"
)

func (s Site) Valid() bool {
	switch s {
	case SiteMercari, SiteYahoo, SiteSurugaya, SiteMandarake:
		return true
	default:
		return false
	}
}

func SiteForHunter(t HunterType) Site {
	return Site(strings.ToLower(string(t)))
}

type SearchCondition struct {
	Keyword         string   `json:"keyword"`
	ExcludeKeyword  string   `json:"excludeKeyword,omitempty"`
	Status          []string `json:"status,omitempty"`
	CategoryID      []string `json:"categoryId,omitempty"`
	PriceMin        *int     `json:"priceMin,omitempty"`
	PriceMax        *int     `json:"priceMax,omitempty"`
	ItemConditionID []int    `json:"itemConditionId,omitempty"`
	ShippingPayerID []int    `json:"shippingPayerId,omitempty"`
	PageSize        int      `json:"pageSize,omitempty"`
	Category        string   `json:"category,omitempty"`
	Epoch           int      `json:"epoch,omitempty"`
	AdultMode       bool     `json:"adultMode,omitempty"`
	AdultOnly       bool     `json:"adultOnly,omitempty"`
	Page            int      `json:"page,omitempty"`
}

type SurveillanceCondition struct {
	Type   Site   `json:"type"`
	GoodID string `json:"goodId"`
}

type FreezingRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type Watcher struct {
	HunterInstanceID      string     `json:"hunterInstanceId"`
	UserEmail             string     `json:"userEmail"`
	Type                  HunterType `json:"type"`
	FreezingStart         string     `json:"freezingStart,omitempty"`
	FreezingEnd           string     `json:"freezingEnd,omitempty"`
	Schedule              string     `json:"schedule"`
	SearchConditionSchema string     `json:"searchConditionSchema"`
	Snapshot              string     `json:"snapshot,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

func (w Watcher) SearchCondition() (SearchCondition, error) {
	var condition SearchCondition
	err := json.Unmarshal([]byte(w.SearchConditionSchema), &condition)
	return condition, err
}

func (w Watcher) SurveillanceCondition() (SurveillanceCondition, error) {
	var condition SurveillanceCondition
	err := json.Unmarshal([]byte(w.SearchConditionSchema), &condition)
	return condition, err
}

type Item struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Price            string   `json:"price,omitempty"`
	MarketplacePrice string   `json:"marketPlacePrice,omitempty"`
	Thumbnail        string   `json:"thumbImgUrl,omitempty"`
	Thumbnails       []string `json:"thumbnails,omitempty"`
	Status           string   `json:"status,omitempty"`
	CurrentPrice     int      `json:"currentPrice,omitempty"`
	BuyNowPrice      int      `json:"buyNowPrice,omitempty"`
	CurrentBidCount  int      `json:"currentBidCount,omitempty"`
	EndTime          int64    `json:"endTime,omitempty"`
	FreeShipping     bool     `json:"isFreeShipping,omitempty"`
	BrandNew         bool     `json:"isBrandNew,omitempty"`
}

func (i Item) DisplayPrice() string {
	if i.Price != "" {
		return i.Price
	}
	if i.MarketplacePrice != "" {
		return i.MarketplacePrice
	}
	if i.CurrentPrice != 0 {
		return fmtInt(i.CurrentPrice)
	}
	return ""
}

func fmtInt(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	buf := [24]byte{}
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

type Snapshot struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Price      string   `json:"price"`
	Status     string   `json:"status"`
	Thumbnails []string `json:"thumbnails"`
}

type Mail struct {
	To      string
	Subject string
	HTML    string
	Text    string
}
