import { Controller, Get, Provide, Inject } from "@midwayjs/decorator";
import { Context } from "egg";
import { readFileSync } from "fs";
import path from "path";
import CipherServive from "../service/cipher";

@Provide()
@Controller("/api/config")
export class ConfigController {
  @Inject()
  ctx: Context;

  @Inject()
  cipherService: CipherServive;

  @Get("/proxy")
  async getProxyConfig() {
    const configPath = path.resolve(__dirname, "../private/config.yaml");
    const configContent = readFileSync(configPath, "utf-8");
    const payload = await this.cipherService.encode(configContent);
    return payload;
  }
}
