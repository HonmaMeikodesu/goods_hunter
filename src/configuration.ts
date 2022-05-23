import * as unittestConfig from "./config/config.unittest";
import * as localConfig from "./config/config.local";
import * as defaultConfig from "./config/config.default";
import * as webFramework from "@midwayjs/web";
import { App, Configuration } from "@midwayjs/decorator";
import { ILifeCycle } from "@midwayjs/core";
import * as task from "@midwayjs/task";
import * as axios from "@midwayjs/axios";
import * as redis from "@midwayjs/redis";
import * as orm from "@midwayjs/orm";
import { Application } from "egg";

@Configuration({
  imports: [webFramework, axios, redis, task, orm],
  importConfigs: [
    { default: defaultConfig, local: localConfig, unittest: unittestConfig },
  ],
  conflictCheck: true,
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: Application;

  async onReady() {}
}
