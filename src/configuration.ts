import { App, Configuration } from '@midwayjs/decorator';
import { ILifeCycle } from '@midwayjs/core';
import * as task from '@midwayjs/task';
import * as axios from "@midwayjs/axios";
import * as redis from '@midwayjs/redis';
import * as orm from "@midwayjs/orm";
import { Application } from 'egg';
import { join } from 'path';

@Configuration({
  imports: [
    axios, redis, task, orm
  ],
  importConfigs: [join(__dirname, './config')],
  conflictCheck: true,
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: Application;

  async onReady() {}
}
