import { EntityModel } from "@midwayjs/orm";
import { Column, PrimaryColumn, UpdateDateColumn, CreateDateColumn } from "typeorm";

@EntityModel()
export class User {
    @PrimaryColumn("varchar")
    email: string;

    @Column("varchar", { nullable: false,  })
    password: string;

    @CreateDateColumn()
    createdAt: string;

    @UpdateDateColumn()
    updatedAt: string;

}