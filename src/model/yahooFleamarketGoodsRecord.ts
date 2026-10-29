import { EntityModel } from "@midwayjs/orm";
import { Column, CreateDateColumn, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { YahooFleamarketHunter } from "./yahooFleamarketHunter";

@EntityModel()
export class YahooFleamarketGoodsRecord {
  @ManyToOne(() => YahooFleamarketHunter, "goodsRecords", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  @JoinColumn({ name: "hunterInstanceId" })
  hunter: YahooFleamarketHunter;

  @PrimaryColumn("varchar", { length: 200 })
  id: string;

  @Column("text")
  name: string;

  @Column("bigint")
  price: number;

  @Column("text")
  thumbnailImageUrl: string;

  @Column("text")
  itemUrl: string;

  @Column("varchar")
  status: string;

  @Column("varchar", { nullable: true })
  openTime: string;

  @Column("boolean", { default: false })
  notificationPending: boolean;

  @Column("datetime", { nullable: true })
  notifiedAt: Date;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
