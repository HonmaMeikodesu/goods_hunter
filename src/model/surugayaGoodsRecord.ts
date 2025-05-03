import { EntityModel } from "@midwayjs/orm";
import { PrimaryColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { SurugayaHunter } from "./surugaya";

@EntityModel()
export class SurugayaGoodsRecord {
  @ManyToOne(() => SurugayaHunter, "surugayaGoodsRecords", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  hunter: SurugayaHunter;

  @PrimaryColumn("varchar", { nullable: false })
  id: string;

  @Column("varchar", { nullable: false })
  name: string;

  @Column("varchar", { nullable: true })
  price: string;

  @Column("varchar", { nullable: true })
  marketPlacePrice: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

