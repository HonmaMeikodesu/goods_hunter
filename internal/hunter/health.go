package hunter

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

const yahooAlertKey = "goods-hunter:yahoo:login-alert:v1"
const dailyReportPrefix = "goods-hunter:search-daily-report:"

func (s *Service) checkYahoo(ctx context.Context) {
	reason := s.collector.YahooHeartbeat(ctx)
	s.logger.Info("Yahoo session check", "reason", reason)
	switch reason {
	case "NEEDS_LOGIN", "FC_NEEDS_LOGIN", "COOKIES_EXPIRED":
	default:
		return
	}
	if s.cfg.Email.ContactSystemOwner == "" {
		return
	}
	claimed, err := s.cache.SetNX(ctx, yahooAlertKey, "1", 24*time.Hour).Result()
	if err != nil {
		s.logger.Error("Yahoo session alert suppressed: cooldown store unavailable")
		return
	}
	if !claimed {
		return
	}
	err = s.sender.Send(ctx, notify.Message{
		To: s.cfg.Email.ContactSystemOwner, Subject: "Yahoo session needs login",
		Text: fmt.Sprintf("Yahoo session requires login or its cookies have expired (%s). "+
			"Check the session manager status and use the remote login command if needed. "+
			"Reminders are limited to once per 24 hours.", reason),
	})
	if err != nil {
		s.logger.Error("Yahoo session alert delivery failed; daily cooldown retained")
	}
}

func (s *Service) reportToday(ctx context.Context, now time.Time) {
	local := now.In(s.cfg.Location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.cfg.Location)
	end := time.Date(local.Year(), local.Month(), local.Day(), 22, 0, 0, 0, s.cfg.Location)
	date := local.Format(time.DateOnly)
	claimed, err := s.cache.SetNX(ctx, dailyReportPrefix+date, "1", 48*time.Hour).Result()
	if err != nil {
		s.logger.Error("Could not claim search scan report", "date", date, "error", err)
		return
	}
	if !claimed {
		return
	}
	counts, err := s.db.ScanCounts(ctx, start, end)
	if err != nil {
		s.logger.Error("Could not read search scan counts", "date", date, "error", err)
		return
	}
	text := formatReport(date, counts)
	s.logger.Info("商品搜索监控日报\n" + text)
	if s.cfg.Email.ContactSystemOwner != "" {
		err := s.sender.Send(ctx, notify.Message{
			To: s.cfg.Email.ContactSystemOwner, Subject: "商品搜索监控日报 · " + date, Text: text,
		})
		if err != nil {
			s.logger.Error("Could not send search scan report", "date", date, "error", err)
		}
	}
}

var reportSites = [...]struct {
	site model.Site
	name string
}{
	{model.Mercari, "Mercari"},
	{model.Yahoo, "Yahoo!オークション"},
	{model.Surugaya, "骏河屋"},
	{model.Mandarake, "Mandarake"},
	{model.YahooFleamarket, "Yahoo!フリマ"},
	{model.Xianyu, "闲鱼"},
}

func formatReport(date string, counts []store.ScanCount) string {
	var report strings.Builder
	fmt.Fprintf(&report, "%s 00:00–22:00（北京时间）\n", date)
	for _, site := range reportSites {
		valid, abnormal := 0, 0
		var failures []store.ScanCount
		for _, row := range counts {
			if row.Site != site.site {
				continue
			}
			if row.Outcome == "VALID" {
				valid += row.Count
			} else {
				abnormal += row.Count
				failures = append(failures, row)
			}
		}
		total := valid + abnormal
		if total == 0 {
			fmt.Fprintf(&report, "\n%s｜无扫描记录", site.name)
			continue
		}
		fmt.Fprintf(&report, "\n%s｜共 %d 次 · 有效 %d 次 (%.1f%%) · 异常 %d 次 (%.1f%%)",
			site.name, total, valid, percentage(valid, total), abnormal, percentage(abnormal, total))
		sort.Slice(failures, func(i, j int) bool {
			if failures[i].Count == failures[j].Count {
				return failures[i].Outcome < failures[j].Outcome
			}
			return failures[i].Count > failures[j].Count
		})
		for _, row := range failures {
			label := market.Labels[market.Failure(row.Outcome)]
			if label == "" {
				label = market.Labels[market.Unknown]
			}
			fmt.Fprintf(&report, "\n  %s %d 次 (%.1f%%)", label, row.Count, percentage(row.Count, abnormal))
		}
	}
	return report.String()
}

func percentage(n, total int) float64 {
	return float64(n) * 100 / float64(total)
}
