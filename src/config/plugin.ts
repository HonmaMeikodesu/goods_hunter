import { EggPlugin } from "egg";
export default {
  logrotator: false, // disable when use @midwayjs/logger
  static: false,
  view: false,
  cors: {
    enable: true,
    package: 'egg-cors',
  }
} as EggPlugin;
