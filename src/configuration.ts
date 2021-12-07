import { App, Configuration } from '@midwayjs/decorator';
import { ILifeCycle } from '@midwayjs/core';
import * as axios from "@midwayjs/axios";
import { Application } from 'egg';
import { join } from 'path';
import * as all from "./api/request";
console.log(all);

@Configuration({
  imports: [
    axios
  ],
  importConfigs: [join(__dirname, './config')],
  conflictCheck: true,
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: Application;

  async onReady() {}
}
