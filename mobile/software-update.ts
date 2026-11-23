import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { NativeModules, Platform } from 'react-native';
import { createSoftwareUpdater, parseApkRelease } from './software-update-core';
import { authorizeApk, createApkInstaller, type NativeApkInstaller } from './apk-download';
import { readSession, serviceOrigin as serviceUrl } from './api';
const native = NativeModules.GoodsHunterApkInstaller as NativeApkInstaller | undefined;
const installer = native && createApkInstaller(native, async (release, signal) => {
  const connection = await readSession();
  if (!connection || connection.server.replace(/\/$/, '') !== serviceUrl) throw Object.assign(new Error('请先登录谷子猎手。'), { code: 'apk_authorization' });
  return authorizeApk(release, serviceUrl, connection.token, signal);
});
export const softwareUpdater = createSoftwareUpdater({
  enabled: Platform.OS === 'android' && Updates.isEnabled && !__DEV__,
  version: Application.nativeApplicationVersion ?? '开发版',
  versionCode: Number(Application.nativeBuildVersion ?? 0),
  revision: Updates.isEmbeddedLaunch ? '内置版本' : `热更新 ${Updates.updateId?.slice(0, 8) ?? ''}`,
  latest: async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${serviceUrl}/api/mobile/updates/latest`, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error('更新服务暂不可用。');
      return parseApkRelease(await response.json());
    } finally { clearTimeout(timer); }
  },
  check: Updates.checkForUpdateAsync, download: Updates.fetchUpdateAsync,
  reload: () => Updates.reloadAsync(), installer,
});
