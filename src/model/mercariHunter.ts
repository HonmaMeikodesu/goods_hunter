import { EntityModel } from "@midwayjs/orm";
import { ManyToOne, Column } from "typeorm";
import { User } from "./user";

@EntityModel()
export class MercariHunter {
  @ManyToOne(() => User, "mercariHunters", { primary: true })
  user: User;

  @Column("varchar", { primary: true })
  hunterInstanceId: string;

}