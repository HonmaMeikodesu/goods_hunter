import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";
import { MandarakeGoodsRecord } from "./mandarakeGoodsRecord";

@EntityModel()
export class MandarakeHunter implements GoodsHunterModelBase {
  @ManyToOne(() => User, "mandarakeHunters", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
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

  @OneToMany(() => MandarakeGoodsRecord, "hunter", { cascade: true })
  mandarakeGoodsRecords: MandarakeGoodsRecord[];
}
