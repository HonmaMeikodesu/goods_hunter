package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

var ErrCondition = errors.New("invalid search condition")

const MaxSafeInteger = 1<<53 - 1

type Condition struct {
	Keyword        string
	Category       string
	Epoch          int
	Page           int
	AdultOnly      bool
	AdultMode      bool
	Min            *int64
	Max            *int64
	Include        []string
	Exclude        []string
	NotifyExisting bool
	DetailSite     string
	GoodID         string
	Schema         string
}

var detailID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,200}$`)

// ReadCondition reads both legacy database rows and new requests. It retains
// the original fields for the older search sites, whose clients edit task JSON.
func ReadCondition(site Site, raw string) (Condition, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &fields) != nil || fields == nil {
		return Condition{}, ErrCondition
	}
	if site == Surveillance {
		return readDetailCondition([]byte(raw))
	}
	var c Condition
	if json.Unmarshal(fields["keyword"], &c.Keyword) != nil || strings.TrimSpace(c.Keyword) == "" {
		return Condition{}, ErrCondition
	}
	if site.UsesBaseline() {
		return readFilteredCondition(site, fields, strings.TrimSpace(c.Keyword))
	}
	c.Epoch, c.Page = 1, 1
	switch site {
	case Yahoo, Surugaya:
		var options struct {
			Category  any
			Epoch     float64
			AdultOnly bool
			AdultMode bool
		}
		if json.Unmarshal([]byte(raw), &options) != nil ||
			options.Epoch < 0 || options.Epoch > math.MaxInt32 || math.Trunc(options.Epoch) != options.Epoch {
			return Condition{}, ErrCondition
		}
		switch category := options.Category.(type) {
		case string:
			c.Category = category
		case float64:
			categoryJSON, _ := json.Marshal(category)
			c.Category = string(categoryJSON)
		case nil:
		default:
			return Condition{}, ErrCondition
		}
		c.Epoch = max(1, int(options.Epoch))
		c.AdultOnly, c.AdultMode = options.AdultOnly, options.AdultMode
	case Mandarake:
		if page, ok := fields["page"]; ok {
			var number float64
			if json.Unmarshal(page, &number) != nil || math.Trunc(number) != number ||
				number < 1 || number > math.MaxInt32 {
				return Condition{}, ErrCondition
			}
			c.Page = int(number)
		}
	}
	var compact bytes.Buffer
	_ = json.Compact(&compact, []byte(raw))
	c.Schema = compact.String()
	return c, nil
}

func readDetailCondition(raw []byte) (Condition, error) {
	var detail struct {
		Type   string `json:"type"`
		GoodID string `json:"goodId"`
	}
	if json.Unmarshal(raw, &detail) != nil || !detailID.MatchString(detail.GoodID) {
		return Condition{}, ErrCondition
	}
	switch detail.Type {
	case "mercari", "yahoo", "surugaya", "mandarake":
		schema, _ := json.Marshal(detail)
		return Condition{DetailSite: detail.Type, GoodID: detail.GoodID, Schema: string(schema)}, nil
	default:
		return Condition{}, ErrCondition
	}
}

func readFilteredCondition(site Site, fields map[string]json.RawMessage, keyword string) (Condition, error) {
	xianyu := site == Xianyu
	maxLength := 200
	if xianyu {
		maxLength = 100
	}
	if len(utf16.Encode([]rune(keyword))) > maxLength {
		return Condition{}, ErrCondition
	}
	c := Condition{Keyword: keyword, Epoch: 1, Exclude: []string{}, Include: []string{}}
	normalized := map[string]any{"keyword": keyword}
	for key, value := range fields {
		switch key {
		case "keyword":
		case "minPrice", "maxPrice":
			var price float64
			if bytes.Equal(value, []byte("null")) || json.Unmarshal(value, &price) != nil {
				return Condition{}, ErrCondition
			}
			amount := price
			if xianyu {
				amount = price * 100
			}
			rounded := math.Round(amount)
			if price < 0 || rounded > MaxSafeInteger ||
				(!xianyu && rounded != amount) || math.Abs(rounded-amount) > 0.000001 {
				return Condition{}, ErrCondition
			}
			minorUnits := int64(rounded)
			if key == "minPrice" {
				c.Min = &minorUnits
			} else {
				c.Max = &minorUnits
			}
			normalized[key] = price
		case "excludeKeywords", "includeKeywords":
			if key == "includeKeywords" && !xianyu {
				continue
			}
			words, err := readWords(value, maxLength)
			if err != nil {
				return Condition{}, err
			}
			if key == "includeKeywords" {
				c.Include = words
			} else {
				c.Exclude = words
			}
		case "notifyExisting":
			if bytes.Equal(value, []byte("null")) || json.Unmarshal(value, &c.NotifyExisting) != nil {
				return Condition{}, ErrCondition
			}
		case "epoch":
			if xianyu {
				return Condition{}, ErrCondition
			}
			var epoch float64
			if json.Unmarshal(value, &epoch) != nil || epoch < 1 || epoch > 3 || math.Trunc(epoch) != epoch {
				return Condition{}, ErrCondition
			}
			c.Epoch = int(epoch)
		default:
			if xianyu {
				return Condition{}, ErrCondition
			}
		}
	}
	if c.Min != nil && c.Max != nil && *c.Min > *c.Max {
		return Condition{}, ErrCondition
	}
	if xianyu {
		normalized["includeKeywords"] = c.Include
	} else {
		normalized["epoch"] = c.Epoch
	}
	normalized["excludeKeywords"] = c.Exclude
	normalized["notifyExisting"] = c.NotifyExisting
	schema, _ := json.Marshal(normalized)
	c.Schema = string(schema)
	return c, nil
}

func readWords(raw []byte, maxLength int) ([]string, error) {
	var words []string
	if json.Unmarshal(raw, &words) != nil || words == nil || len(words) > 30 {
		return nil, ErrCondition
	}
	for i, word := range words {
		if strings.TrimSpace(word) == "" || len(utf16.Encode([]rune(word))) > maxLength {
			return nil, ErrCondition
		}
		words[i] = strings.ToLower(strings.TrimSpace(word))
	}
	slices.Sort(words)
	return slices.Compact(words), nil
}

func (c Condition) Matches(name string, amount int64) bool {
	if (c.Min != nil && amount < *c.Min) || (c.Max != nil && amount > *c.Max) {
		return false
	}
	title := strings.ToLower(name)
	for _, word := range c.Exclude {
		if strings.Contains(title, word) {
			return false
		}
	}
	for _, word := range c.Include {
		if !strings.Contains(title, word) {
			return false
		}
	}
	return true
}
