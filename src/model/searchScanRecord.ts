import { EntityModel } from "@midwayjs/orm";
import { Column, Index, PrimaryGeneratedColumn } from "typeorm";
import type { ScanFailure } from "../api/site/searchScan";

export const searchSites = {
  Mercari: "Mercari",
  Yahoo: "Yahoo!オークション",
  Surugaya: "骏河屋",
  Mandarake: "Mandarake",
  YahooFleamarket: "Yahoo!フリマ",
  Xianyu: "闲鱼",
} as const;

export type SearchSite = keyof typeof searchSites;
export type ScanOutcome = "VALID" | ScanFailure;

@EntityModel()
export class SearchScanRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 24 })
  site: SearchSite;

  @Column("varchar", { length: 32 })
  outcome: ScanOutcome;

  @Index()
  @Column("datetime", { precision: 3 })
  completedAt: Date;
}
