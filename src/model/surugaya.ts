import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";

@EntityModel()
export class SurugayaHunter implements GoodsHunterModelBase {
  @ManyToOne(() => User, "surugayaHunters", { primary: true })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

  @Column("longtext", {
    default: null
  })
  lastSeenGoodList: string;

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
