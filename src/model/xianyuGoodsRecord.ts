import { EntityModel } from "@midwayjs/orm";
import { Column, CreateDateColumn, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { XianyuHunter } from "./xianyuHunter";

@EntityModel()
export class XianyuGoodsRecord {
  @ManyToOne(() => XianyuHunter, "goodsRecords", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  @JoinColumn({ name: "hunterInstanceId" })
  hunter: XianyuHunter;

  @PrimaryColumn("varchar", { length: 200 })
  id: string;

  @Column("text")
  name: string;

  @Column("bigint")
  priceFen: number;

  @Column("text")
  thumbnailImageUrl: string;

  @Column("text")
  itemUrl: string;

  @Column("varchar", { nullable: true })
  publishedAt: string;

  @Column("boolean", { default: false })
  notificationPending: boolean;

  @Column("datetime", { nullable: true })
  notifiedAt: Date;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
