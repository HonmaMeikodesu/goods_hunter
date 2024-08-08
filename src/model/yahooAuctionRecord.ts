import { EntityModel } from "@midwayjs/orm";
import { PrimaryColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { YahooHunter } from "./yahooHunter";

@EntityModel()
export class YahooAuctionRecord {
  @ManyToOne(() => YahooHunter, "yahooAuctionRecords", { primary: true })
  hunter: YahooHunter;

  @PrimaryColumn("varchar", { nullable: false })
  auctionId: string;

  @Column("varchar", { nullable: false })
  auctionName: string;

  @Column("int", { nullable: false })
  currentPrice: number;

  @Column("int", { nullable: true })
  buyNowPrice: number;

  @Column("int", { nullable: true })
  currentBidCount: number;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

