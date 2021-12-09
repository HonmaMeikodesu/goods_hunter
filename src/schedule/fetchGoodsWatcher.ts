import { Provide, Inject, TaskLocal } from "@midwayjs/decorator";

@Provide()
export class FetchGoodsWatcher {

  @Inject()
  logger: any;

  @TaskLocal('* * * * *')
  async watchSchedule() {
    console.log(this.logger);
  }
}