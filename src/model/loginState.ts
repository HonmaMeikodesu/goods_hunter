import { EntityModel } from "@midwayjs/orm";
import { PrimaryColumn, ManyToOne, Column } from "typeorm";
import { User } from "./user";

@EntityModel()
export class LoginState {
  @ManyToOne(() => User, "loginStates", { primary: true })
  user: User;

  @PrimaryColumn("varchar", { nullable: false })
  loginState: string;

  @Column("datetime", { nullable: false })
  expiredAt: string;

}