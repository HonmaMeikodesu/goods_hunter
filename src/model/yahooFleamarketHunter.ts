import { EntityModel } from "@midwayjs/orm";
import { Column, CreateDateColumn, ManyToOne, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";
import { YahooFleamarketGoodsRecord } from "./yahooFleamarketGoodsRecord";

@EntityModel()
export class YahooFleamarketHunter implements GoodsHunterModelBase {
  @PrimaryColumn("varchar")
  hunterInstanceId: string;

  @ManyToOne(() => User, "yahooFleamarketHunters", { nullable: false, onDelete: "CASCADE", onUpdate: "CASCADE" })
  user: User;

  @Column("time", { nullable: true })
  freezingStart: string;

  @Column("time", { nullable: true })
  freezingEnd: string;

  @Column("varchar")
  schedule: string;

  @Column("longtext")
  searchConditionSchema: string;

  @Column("boolean", { default: false })
  initialized: boolean;

  @OneToMany(() => YahooFleamarketGoodsRecord, "hunter")
  goodsRecords: YahooFleamarketGoodsRecord[];

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
