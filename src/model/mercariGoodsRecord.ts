import { EntityModel } from "@midwayjs/orm";
import { PrimaryColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { MercariHunter } from "./mercariHunter";

@EntityModel()
export class MercariGoodsRecord {
  @ManyToOne(() => MercariHunter, "mercariGoodsRecords", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  hunter: MercariHunter;

  @PrimaryColumn("varchar", { nullable: false })
  id: string;

  @Column("varchar", { nullable: false, length: 1500 })
  name: string;

  @Column("varchar", { nullable: true })
  price: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
