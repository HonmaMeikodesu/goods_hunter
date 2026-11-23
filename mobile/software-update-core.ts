export type ApkRelease = { version: string; versionCode: number; notes: string;
  downloadUrl?: string; sha256?: string; bytes?: number; privateDownload?: boolean };
export type DownloadableApk = ApkRelease & { downloadUrl: string; sha256: string; bytes: number };
export type ApkProgress = { received: number; total: number };
export type ApkInstaller = {
  cached: (release: DownloadableApk) => Promise<boolean>;
  download: (release: DownloadableApk, progress: (value: ApkProgress) => void) => Promise<void>;
  cancel: () => Promise<void>;
  install: (release: DownloadableApk) => Promise<'permission' | 'installer'>;
};
export function canDownloadApk(release: ApkRelease | null): release is DownloadableApk {
  return !!release?.downloadUrl && !!release.sha256 && !!release.bytes;
}
export type SoftwareUpdateState = {
  version: string;
  revision: string;
  status: 'idle' | 'disabled' | 'checking' | 'downloading' | 'ready' | 'current' | 'apk' | 'apk-downloading' | 'apk-ready' | 'apk-error' | 'error';
  message: string;
  notes: string;
  checkedAt: string | null;
  apk: ApkRelease | null;
  apkProgress: ApkProgress | null;
};
export type UpdateResult = { isAvailable?: boolean; isNew?: boolean; isRollBackToEmbedded?: boolean; manifest?: unknown };

export function parseApkRelease(value: unknown): ApkRelease {
  const r = value as (Partial<ApkRelease> & { downloadGrantUrl?: string }) | null;
  if (!r || typeof r.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version)
    || !Number.isSafeInteger(r.versionCode) || r.versionCode! < 1 || r.versionCode! > 2147483647 || typeof r.notes !== 'string' || r.notes.length > 2000) {
    throw new Error('Invalid application release');
  }
  const base = { version: r.version, versionCode: r.versionCode!, notes: r.notes };
  const address = r.downloadGrantUrl ?? r.downloadUrl;
  if (address === undefined) return base; // Older publications only carried version information.
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('Invalid APK download address'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || address.length > 4096
    || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)
    || !Number.isSafeInteger(r.bytes) || r.bytes! <= 0 || r.bytes! > 200 * 1024 * 1024) throw new Error('Invalid APK download descriptor');
  return { ...base, downloadUrl: address, sha256: r.sha256, bytes: r.bytes!, ...(r.downloadGrantUrl ? { privateDownload: true } : {}) };
}

function updateNotes(manifest: unknown) {
  const notes = (manifest as { extra?: { goodsHunterUpdate?: { notes?: unknown } } } | undefined)?.extra?.goodsHunterUpdate?.notes;
  return typeof notes === 'string' ? notes.slice(0, 2000) : '';
}

/** Owns update sequencing; never reloads while a check or download is running. */
export function createSoftwareUpdater(deps: {
  enabled: boolean; version: string; versionCode: number; revision: string;
  latest: () => Promise<ApkRelease | null>;
  check?: () => Promise<UpdateResult>; download: () => Promise<UpdateResult>; reload: () => Promise<void>;
  installer?: ApkInstaller;
  record?: (action: string, error?: unknown) => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let state: SoftwareUpdateState = { version: deps.version, revision: deps.revision,
    status: deps.enabled ? 'idle' : 'disabled', message: deps.enabled ? '登录后自动检查更新' : '此环境不支持应用更新',
    notes: '', checkedAt: null, apk: null, apkProgress: null };
  let lastAttempt: number | null = null;
  let checking: Promise<void> | null = null;
  let restarting = false;
  let apkTask: Promise<void> | null = null;
  let installing = false;
  const listeners = new Set<() => void>();
  const set = (next: Partial<SoftwareUpdateState>) => { state = { ...state, ...next }; listeners.forEach(fn => fn()); };
  async function performCheck() {
    lastAttempt = now();
    set({ status: 'checking', message: '正在检查更新…', apk: null, notes: '', apkProgress: null });
    try {
      const latest = await deps.latest();
      if (latest && latest.versionCode > deps.versionCode) {
        const cached = canDownloadApk(latest) && deps.installer ? await deps.installer.cached(latest) : false;
        set({ status: cached ? 'apk-ready' : 'apk', message: cached ? '安装包已下载并校验，可以覆盖安装' : `发现新版本 ${latest.version}，需要安装更新`, apk: latest, notes: latest.notes, checkedAt: new Date(now()).toISOString() });
        deps.record?.('apk'); return;
      }
      const result = await deps.check?.();
      if (result?.isAvailable || result?.isRollBackToEmbedded) {
        set({ status: 'downloading', message: '正在下载更新…', notes: updateNotes(result.manifest) });
        const downloaded = await deps.download();
        if (downloaded.isNew || downloaded.isRollBackToEmbedded) {
          set({ status: 'ready', message: '更新已下载，重启应用后生效', notes: updateNotes(downloaded.manifest) || state.notes, checkedAt: new Date(now()).toISOString() });
          deps.record?.('download'); return;
        }
      }
      set({ status: 'current', message: deps.check ? '已是最新版本' : '暂无可用安装包更新', checkedAt: new Date(now()).toISOString() });
      deps.record?.('check');
    } catch (error) {
      set({ status: 'error', message: '更新检查或下载失败，请稍后重试' });
      deps.record?.('check', error);
    }
  }
  return {
    read: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    check(force = false): Promise<void> {
      if (!deps.enabled || state.status === 'ready' || (state.status === 'apk-ready' && !force) || restarting || apkTask || installing) return Promise.resolve();
      if (checking) return checking;
      if (!force && lastAttempt !== null && now() - lastAttempt < 60 * 60_000) return Promise.resolve();
      checking = performCheck().finally(() => { checking = null; });
      return checking;
    },
    downloadApk(): Promise<void> {
      if (apkTask) return apkTask;
      const release = state.apk;
      if (!deps.enabled || checking || installing || !['apk', 'apk-error'].includes(state.status) || !canDownloadApk(release) || !deps.installer) return Promise.resolve();
      const installer = deps.installer;
      set({ status: 'apk-downloading', message: '正在下载安装包…', apkProgress: { received: 0, total: release.bytes } });
      apkTask = installer.download(release, value => {
        if (state.status === 'apk-downloading') set({ apkProgress: value });
      }).then(() => {
        set({ status: 'apk-ready', message: '安装包已下载并校验，点击安装新版本', apkProgress: null });
        deps.record?.('apk_download');
      }).catch(error => {
        const cancelled = (error as { code?: string })?.code === 'apk_cancelled';
        const unauthorized = (error as { code?: string })?.code === 'apk_authorization';
        set({ status: cancelled ? 'apk' : 'apk-error', message: cancelled ? '已取消下载，可重新下载' : unauthorized
          ? '下载权限验证失败，请检查设置中的访问凭证' : '安装包下载或校验失败，请检查网络和存储空间后重试', apkProgress: null });
        deps.record?.('apk_download', cancelled ? undefined : error);
      }).finally(() => { apkTask = null; });
      return apkTask;
    },
    async cancelApk() {
      if (!apkTask || !deps.installer) return;
      try { await deps.installer.cancel(); }
      catch { set({ message: '取消未完成，请稍后重试' }); }
    },
    async installApk() {
      const release = state.apk;
      if (state.status !== 'apk-ready' || checking || apkTask || installing || !canDownloadApk(release) || !deps.installer) return;
      installing = true;
      try {
        const result = await deps.installer.install(release);
        set({ message: result === 'permission' ? '请允许安装此来源的应用，返回后再点“安装新版本”' : '已打开系统安装界面；如果取消，可再次点击安装' });
        deps.record?.('apk_install');
      } catch (error) {
        // A cleared/corrupt cache can be downloaded again; a cancelled system installer keeps its validated file.
        const valid = await deps.installer.cached(release).catch(() => false);
        set({ status: valid ? 'apk-ready' : 'apk-error', message: valid ? '安装界面未能打开，请回到应用后重试' : '安装包已失效，请重新下载' });
        deps.record?.('apk_install', error);
      } finally { installing = false; }
    },
    async restart() {
      if (state.status !== 'ready' || checking || restarting) return;
      restarting = true;
      try { await deps.reload(); }
      catch (error) {
        set({ message: '重启未完成，请重试或关闭后重新打开应用' });
        deps.record?.('restart', error);
      } finally { restarting = false; }
    },
  };
}
