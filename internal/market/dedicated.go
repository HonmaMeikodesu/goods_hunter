package market

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

const fleaItem = "https://paypayfleamarket.yahoo.co.jp/item/"
const xianyuItem = "https://www.goofish.com/item?id="

type fleaResponse struct {
	Success               bool
	Source                string
	Keyword               string
	Page                  int
	Offset                *int
	TotalResultsAvailable *float64
	Items                 []json.RawMessage
}

func (c *Client) fleamarketSearch(ctx context.Context, condition model.Condition) ([]model.Item, error) {
	var items []model.Item
	for page := 1; page <= condition.Epoch; page++ {
		request := struct {
			Keyword    string `json:"keyword"`
			Page       int    `json:"page"`
			OnSaleOnly bool   `json:"onSaleOnly"`
		}{condition.Keyword, page, true}
		var response fleaResponse
		if err := c.invoke(ctx, c.fc.YahooFleamarketURL, request, &response); err != nil {
			return nil, err
		}
		if !response.Success || response.Source != "yahooFleamarket" || response.Keyword != condition.Keyword ||
			response.Page != page || response.Offset == nil || *response.Offset != (page-1)*100 ||
			response.Items == nil || len(response.Items) > 100 || !safeAmount(response.TotalResultsAvailable) {
			return nil, InvalidResponse
		}
		for _, raw := range response.Items {
			var good struct {
				ID                string
				Name              string
				Price             *float64
				Status            *string
				ThumbnailImageURL json.RawMessage
				OpenTime          *string
			}
			if json.Unmarshal(raw, &good) != nil || good.ID == "" || len(utf16.Encode([]rune(good.ID))) > 200 ||
				strings.TrimSpace(good.Name) == "" || !safeAmount(good.Price) || good.Status == nil {
				return nil, InvalidItems
			}
			amount := int64(*good.Price)
			if *good.Status != "OPEN" || !condition.Matches(good.Name, amount) {
				continue
			}
			items = append(items, model.Item{ID: good.ID, Name: good.Name, Amount: amount, Status: *good.Status,
				URL: fleaItem + url.PathEscape(good.ID), Image: httpsImage(good.ThumbnailImageURL), PublishedAt: good.OpenTime})
		}
	}
	return deduplicate(items), nil
}

type xianyuResponse struct {
	Success     bool
	Source      string
	Keyword     string
	Page        int
	PageSize    int
	Sort        string
	Currency    string
	ResultState string
	HasMore     *bool
	Items       []json.RawMessage
}

var xianyuID = regexp.MustCompile(`^[0-9]{1,30}$`)

func (c *Client) xianyuSearch(ctx context.Context, condition model.Condition) ([]model.Item, error) {
	var response xianyuResponse
	if err := c.invoke(ctx, c.fc.XianyuURL, map[string]string{"keyword": condition.Keyword}, &response); err != nil {
		return nil, err
	}
	if !response.Success || response.Source != "xianyu" || response.Keyword != condition.Keyword ||
		response.Page != 1 || response.PageSize != 30 || response.Sort != "newest" || response.Currency != "CNY" ||
		response.HasMore == nil || response.Items == nil || len(response.Items) > 30 {
		return nil, InvalidResponse
	}
	if len(response.Items) == 0 {
		if response.ResultState != "empty" || *response.HasMore {
			return nil, InvalidResponse
		}
		return []model.Item{}, nil
	}
	if response.ResultState != "items" {
		return nil, InvalidResponse
	}
	var items []model.Item
	for _, raw := range response.Items {
		var good struct {
			ID                string
			Name              string
			PriceFen          *float64
			ThumbnailImageURL json.RawMessage
			PublishedAt       json.RawMessage
		}
		if json.Unmarshal(raw, &good) != nil || !xianyuID.MatchString(good.ID) ||
			strings.TrimSpace(good.Name) == "" || !safeAmount(good.PriceFen) {
			return nil, InvalidItems
		}
		published, ok := optionalDate(good.PublishedAt)
		if !ok {
			return nil, InvalidItems
		}
		amount := int64(*good.PriceFen)
		if condition.Matches(good.Name, amount) {
			items = append(items, model.Item{ID: good.ID, Name: good.Name, Amount: amount,
				URL: xianyuItem + good.ID, Image: httpsImage(good.ThumbnailImageURL), PublishedAt: published})
		}
	}
	return deduplicate(items), nil
}

func safeAmount(value *float64) bool {
	return value != nil && *value >= 0 && *value <= model.MaxSafeInteger && math.Trunc(*value) == *value
}

func optionalDate(raw []byte) (*string, bool) {
	if bytes.Equal(raw, []byte("null")) {
		return nil, true
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return nil, false
	}
	for _, layout := range []string{time.RFC3339, time.DateOnly} {
		if _, err := time.Parse(layout, value); err == nil {
			return &value, true
		}
	}
	return nil, false
}

func httpsImage(raw []byte) string {
	var value string
	if json.Unmarshal(raw, &value) != nil || !strings.HasPrefix(value, "https://") {
		return ""
	}
	return resolveURL("", value)
}
