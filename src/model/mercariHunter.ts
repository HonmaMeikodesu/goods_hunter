import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { User } from "./user";
import { GoodsHunterModelBase } from "./types";

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
}

