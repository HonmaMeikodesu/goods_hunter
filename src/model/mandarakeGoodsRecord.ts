import { EntityModel } from "@midwayjs/orm";
import { PrimaryColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { MandarakeHunter } from "./mandarakeHunter";

@EntityModel()
export class MandarakeGoodsRecord {
  @ManyToOne(() => MandarakeHunter, "mandarakeGoodsRecords", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  hunter: MandarakeHunter;

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
