import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";

@EntityModel()
export class YahooHunter implements GoodsHunterModelBase {
  @ManyToOne(() => User, "yahooHunters", { primary: true })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

  @Column("datetime", {
    default: null
  })
  lastShotAt: string;

  @Column("varchar", {
    default: null
  })
  lastSeenAuctionId: string;

  @Column("time", {
    default: null
  })
  freezingStart: string;

  @Column("time", {
    default: null
  })
  freezingEnd: string;

  @Column("varchar")
  schedule: string;

  @Column("longtext")
  searchConditionSchema: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

