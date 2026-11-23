import type { ApkInstaller, ApkProgress, DownloadableApk } from './software-update-core';

export type NativeApkInstaller = {
  cached: ApkInstaller['cached']; cancel: ApkInstaller['cancel']; install: ApkInstaller['install'];
  download: (release: DownloadableApk) => Promise<void>;
  progress: () => Promise<ApkProgress>;
};
const cancelledError = () => Object.assign(new Error('已取消下载'), { code: 'apk_cancelled' });
const authorizationError = () => Object.assign(new Error('下载权限验证失败'), { code: 'apk_authorization' });

export async function authorizeApk(release: DownloadableApk, serviceUrl: string, token: string, signal: AbortSignal,
  request: typeof fetch = fetch, now = Date.now()): Promise<DownloadableApk> {
  const endpoint = `${serviceUrl}/api/mobile/updates/apk/${release.sha256}`;
  // The configured service is the only recipient of the user's credential.
  if (!release.privateDownload || release.downloadUrl !== endpoint || !token || token.length > 4096 || /\s/.test(token)) throw authorizationError();
  const response = await request(endpoint, { signal, redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if ([401, 403].includes(response.status)) throw authorizationError();
  if (!response.ok) throw new Error('下载授权暂不可用');
  const grant = await response.json() as { downloadUrl?: unknown; expiresAt?: unknown; sha256?: unknown; bytes?: unknown };
  if (grant.sha256 !== release.sha256 || grant.bytes !== release.bytes || typeof grant.expiresAt !== 'number'
    || grant.expiresAt <= now || grant.expiresAt > now + 660_000 || typeof grant.downloadUrl !== 'string' || grant.downloadUrl.length > 4096) throw new Error('下载授权无效');
  const url = new URL(grant.downloadUrl);
  if (url.origin !== serviceUrl || url.pathname !== `/api/mobile/updates/apks/${release.sha256}` ||
    url.username || url.password || url.hash) throw new Error('下载授权无效');
  return { ...release, downloadUrl: grant.downloadUrl };
}

export function createApkInstaller(native: NativeApkInstaller, authorize: (release: DownloadableApk, signal: AbortSignal) => Promise<DownloadableApk>): ApkInstaller {
  let active: { controller: AbortController; cancelled: boolean } | null = null;
  return {
    cached: release => native.cached(release), install: release => native.install(release),
    async cancel() { if (active) { active.cancelled = true; active.controller.abort(); } await native.cancel(); },
    async download(release, progress) {
      const task = { controller: new AbortController(), cancelled: false }; active = task;
      let polling = false, reporting = true;
      let timer: ReturnType<typeof setInterval> | undefined;
      const timeout = setTimeout(() => task.controller.abort(), 20_000);
      try {
        const authorized = await authorize(release, task.controller.signal);
        clearTimeout(timeout);
        if (task.cancelled) throw cancelledError();
        timer = setInterval(() => {
          if (polling) return;
          polling = true;
          void native.progress().then(value => { if (reporting) progress(value); }).catch(() => undefined).finally(() => { polling = false; });
        }, 500);
        await native.download(authorized);
        if (task.cancelled) throw cancelledError();
      } catch (error) { if (task.cancelled) throw cancelledError(); throw error; }
      finally { reporting = false; clearTimeout(timeout); clearInterval(timer); if (active === task) active = null; }
    },
  };
}
