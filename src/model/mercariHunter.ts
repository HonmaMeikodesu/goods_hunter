import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";
import { MercariGoodsRecord } from "./mercariGoodsRecord";

@EntityModel()
export class MercariHunter implements GoodsHunterModelBase {
  @ManyToOne(() => User, "mercariHunters", { primary: true, onDelete: "CASCADE", onUpdate: "CASCADE" })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

  @Column("datetime", {
    default: null
  })
  lastShotAt: string;

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

  @OneToMany(() => MercariGoodsRecord, "hunter", { cascade: true })
  mercariGoodsRecords: MercariGoodsRecord[];
}

