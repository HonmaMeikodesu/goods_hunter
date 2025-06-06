import { EntityModel } from "@midwayjs/orm";
import {
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { LoginState } from "./loginState";
import { MercariHunter } from "./mercariHunter";
import { YahooHunter } from "./yahooHunter";
import { SurugayaHunter as SurugayaHunterType } from "./surugaya";
import { SurveillanceRecord } from "./surveillanceRecord";

@EntityModel()
export class User {
  @PrimaryColumn("varchar")
  email: string;

  @Column("varchar", { nullable: false, unique: true })
  password: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  @OneToMany(() => LoginState, "user", { cascade: true })
  loginStates: LoginState[];

  @OneToMany(() => SurveillanceRecord, "user", { cascade: true })
  surveillanceRecords: SurveillanceRecord[];

  @OneToMany(() => MercariHunter, "user", { cascade: true })
  mercariHunters: MercariHunter[];

  @OneToMany(() => YahooHunter, "user", { cascade: true })
  yahooHunters: YahooHunter[];

  @OneToMany(() => SurugayaHunterType, "user", { cascade: true })
  surugayaHunters: SurugayaHunterType[];
}


