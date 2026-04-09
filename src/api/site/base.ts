
import { Provide, Inject, Logger, ScopeEnum, Scope } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";


@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export abstract class ApiBase {
  @Logger()
  logger: ILogger;

  abstract fetchGoodsList(searchOptions: any): Promise<any>

}




