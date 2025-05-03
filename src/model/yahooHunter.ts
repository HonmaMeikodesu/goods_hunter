import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";
import { YahooAuctionRecord } from "./yahooAuctionRecord";

@EntityModel()
export class YahooHunter implements GoodsHunterModelBase {
  @ManyToOne(() => User, "yahooHunters", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

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

  @OneToMany(() => YahooAuctionRecord, "hunter", { cascade: true })
  yahooAuctionRecords: YahooAuctionRecord[];
}



