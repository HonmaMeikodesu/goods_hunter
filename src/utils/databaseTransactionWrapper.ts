import { IMidwayContainer, providerWrapper } from "@midwayjs/core";
import { loggers } from "@midwayjs/logger";
import { getConnection, QueryRunner } from "typeorm";
import { isFunction } from "lodash";
import { ScopeEnum } from "@midwayjs/decorator";

export declare interface DatabaseTransactionWrapper {
  (funcs: {
    pending: (queryRunner: QueryRunner) => Promise<void>;
    resolved?: (queryRunner: QueryRunner) => Promise<void>;
    rejected?: (queryRunner: QueryRunner) => Promise<void>;
  }): Promise<void>;
}

export default async function databaseTransactionWrapper(
  container: IMidwayContainer
) {
  const appLogger = loggers.getLogger("logger");
  return async function (funcs: {
    pending: (queryRunner: QueryRunner) => Promise<void>;
    resolved?: (queryRunner: QueryRunner) => Promise<void>;
    rejected?: (queryRunner: QueryRunner) => Promise<void>;
  }) {
    const { pending, resolved, rejected } = funcs;
    const connection = getConnection();
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await pending(queryRunner);
      await queryRunner.commitTransaction();
      if (isFunction(resolved)) await resolved(queryRunner);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (isFunction(rejected)) await rejected(queryRunner);
      appLogger.error(error?.message || "Unknown database operate error");
    } finally {
      await queryRunner.release();
    }
  };
}

providerWrapper([
  {
    id: "databaseTransactionWrapper",
    provider: databaseTransactionWrapper,
    scope: ScopeEnum.Singleton,
  },
]);
