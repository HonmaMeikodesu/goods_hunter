import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import {User} from "./user";
import {GoodsHunterModelBase} from "./types";

@EntityModel()
export class SurveillanceRecord implements GoodsHunterModelBase {
  @ManyToOne(() => User, "surveillanceRecords", { primary: true })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

  @Column("varchar", { nullable: false })
  searchConditionSchema: string;

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
  snapshot: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

