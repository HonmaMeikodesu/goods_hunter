import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { createSoftwareUpdater, parseApkRelease } from './software-update-core';
import { authorizeApk, createApkInstaller, type NativeApkInstaller } from './apk-download';
import type { Session } from './api';
const native = NativeModules.GoodsHunterApkInstaller as NativeApkInstaller | undefined;

export function createSessionUpdater({ server, token }: Session) {
  const installer = native && createApkInstaller(native, (release, signal) => authorizeApk(release, server, token, signal));
  const signedUpdates = Updates.isEnabled && Constants.expoConfig?.extra?.updatesOrigin === server;
  return createSoftwareUpdater({
    enabled: Platform.OS === 'android' && !__DEV__ && server.startsWith('https://'),
    version: Application.nativeApplicationVersion ?? '开发版',
    versionCode: Number(Application.nativeBuildVersion ?? 0),
    revision: Updates.updateId && !Updates.isEmbeddedLaunch ? `热更新 ${Updates.updateId.slice(0, 8)}` : '内置版本',
    latest: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`${server}/api/mobile/updates/latest`, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
        if ([204, 404].includes(response.status)) return null;
        if (!response.ok) throw new Error('更新服务暂不可用。');
        return parseApkRelease(await response.json());
      } finally { clearTimeout(timer); }
    },
    check: signedUpdates ? Updates.checkForUpdateAsync : undefined,
    download: Updates.fetchUpdateAsync,
    reload: () => Updates.reloadAsync(), installer,
  });
}
