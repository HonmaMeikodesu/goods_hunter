import { Config, Inject, Logger, Provide, Scope, ScopeEnum, TaskLocal } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { InjectEntityModel } from "@midwayjs/orm";
import { RedisService } from "@midwayjs/redis";
import moment from "moment";
import { Repository } from "typeorm";
import { scanFailureLabels, scanFailureReason, ScanFailure } from "../api/site/searchScan";
import type { CustomConfig } from "../config/config.default";
import { ScanOutcome, SearchScanRecord, SearchSite, searchSites } from "../model/searchScanRecord";
import { EmailService } from "./email";

interface ScanCount {
  site: SearchSite;
  outcome: ScanOutcome;
  count: string | number;
}

function percentage(count: number, total: number): string {
  return `${(count * 100 / total).toFixed(1)}%`;
}

export function formatScanReport(date: string, counts: ScanCount[]): string {
  const lines = [`${date} 00:00–22:00（北京时间）`, ""];
  for (const [site, name] of Object.entries(searchSites)) {
    const siteCounts = counts.filter(row => row.site === site);
    if (!siteCounts.length) {
      lines.push(`${name}｜无扫描记录`);
      continue;
    }
    const valid = Number(siteCounts.find(row => row.outcome === "VALID")?.count || 0);
    const failures = siteCounts.filter(row => row.outcome !== "VALID").sort((a, b) =>
      Number(b.count) - Number(a.count) || a.outcome.localeCompare(b.outcome));
    const abnormal = failures.reduce((sum, row) => sum + Number(row.count), 0);
    const total = valid + abnormal;
    lines.push(`${name}｜共 ${total} 次 · 有效 ${valid} 次 (${percentage(valid, total)}) · 异常 ${abnormal} 次 (${percentage(abnormal, total)})`);
    for (const { outcome, count } of failures) {
      const label = scanFailureLabels[outcome as ScanFailure] || scanFailureLabels.UNKNOWN;
      lines.push(`  ${label} ${count} 次 (${percentage(Number(count), abnormal)})`);
    }
  }
  return lines.join("\n");
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class SearchScanMonitor {
  @InjectEntityModel(SearchScanRecord)
  records: Repository<SearchScanRecord>;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @Inject()
  emailService: EmailService;

  @Config("emailConfig")
  mailInfo: CustomConfig["emailConfig"];

  @Logger()
  logger: ILogger;

  async track<T>(site: SearchSite, collect: () => Promise<T>): Promise<T> {
    let outcome: ScanOutcome = "VALID";
    try {
      return await collect();
    } catch (error) {
      outcome = scanFailureReason(error);
      throw error;
    } finally {
      try {
        await this.records.insert({ site, outcome, completedAt: new Date() });
      } catch (error) {
        this.logger.error(`Could not record ${site} search scan (${outcome}): ${error?.code || error?.name}`);
      }
    }
  }

  @TaskLocal("0 22 * * *")
  async reportToday(now: Date = new Date()): Promise<void> {
    const date = moment(now).utcOffset("+08:00").format("YYYY-MM-DD");
    try {
      // A local task can run on more than one worker. Claim each date once.
      const claimed = await this.redisClient.set(`goods-hunter:search-daily-report:${date}`, "1", "EX", 172800, "NX");
      if (claimed !== "OK") return;

      const start = new Date(`${date}T00:00:00+08:00`);
      const end = new Date(`${date}T22:00:00+08:00`);
      const counts = await this.records.createQueryBuilder("scan")
        .select("scan.site", "site")
        .addSelect("scan.outcome", "outcome")
        .addSelect("COUNT(*)", "count")
        .where("scan.completedAt >= :start AND scan.completedAt < :end", { start, end })
        .groupBy("scan.site")
        .addGroupBy("scan.outcome")
        .getRawMany<ScanCount>();
      const text = formatScanReport(date, counts);
      this.logger.info(`商品搜索监控日报\n${text}`);
      const recipient = this.mailInfo.contactSystemOwner;
      if (recipient) {
        await this.emailService.sendEmail({ to: recipient, subject: `商品搜索监控日报 · ${date}`, text });
      }
    } catch (error) {
      this.logger.error(`Could not publish search scan report for ${date}: ${error?.code || error?.name}`);
    }
  }
}
