import { EntityModel } from "@midwayjs/orm";
import { Column, PrimaryColumn, UpdateDateColumn, CreateDateColumn, OneToMany } from "typeorm";
import { LoginState } from "./loginState";
import { MercariHunter } from "./mercariHunter";

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

    @OneToMany(() => LoginState,"user", { cascade: true })
    loginStates: LoginState[];

    @OneToMany(() => MercariHunter, "user", { cascade: true })
    mercariHunters: MercariHunter[];
}
