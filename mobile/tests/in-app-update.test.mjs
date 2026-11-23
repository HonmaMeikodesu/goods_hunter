import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeApk, createApkInstaller } from '../apk-download.ts';
import { createSoftwareUpdater, parseApkRelease } from '../software-update-core.ts';

test('uses the signed-in session to download and install a new APK inside the app', async () => {
  const server = 'https://hunter.example.test';
  const sha256 = 'a'.repeat(64);
  const now = Date.now();
  const currentVersion = 3;
  const grantURL = `${server}/api/mobile/updates/apk/${sha256}`;
  const signedURL = `${server}/api/mobile/updates/apks/${sha256}?expires=${now + 60_000}&signature=fixture`;
  const release = parseApkRelease({ version: '0.2.2', versionCode: 4, notes: '', sha256, bytes: 100, downloadGrantUrl: grantURL });
  const calls = [];
  const native = {
    async cached(pack) { assert.equal(pack.sha256, sha256); return false; },
    async download(pack) { assert.equal(pack.downloadUrl, signedURL); calls.push('download'); },
    async install(pack) { assert.equal(pack.sha256, sha256); calls.push('install'); return 'installer'; },
    async cancel() { assert.fail('unexpected cancellation'); },
  };
  const authorize = (pack, signal) => authorizeApk(pack, server, 'fixture-session', signal, async (url, options) => {
    assert.equal(url, grantURL);
    assert.equal(options.headers.Authorization, 'Bearer fixture-session');
    assert.equal(options.redirect, 'error');
    calls.push('authorize');
    return Response.json({ downloadUrl: signedURL, expiresAt: now + 60_000, sha256, bytes: 100 });
  }, now);
  const updater = createSoftwareUpdater({
    enabled: true, version: '0.2.1', versionCode: currentVersion, revision: '内置版本',
    latest: async () => release,
    download: async () => assert.fail('requested a hot update for an APK release'),
    reload: async () => assert.fail('should open the system installer'),
    installer: createApkInstaller(native, authorize),
  });

  await updater.check();
  assert.equal(updater.read().status, 'apk');
  assert.equal(updater.read().apk.version, '0.2.2');
  assert.deepEqual(calls, []);
  await updater.downloadApk();
  assert.equal(updater.read().status, 'apk-ready');
  await updater.installApk();
  assert.deepEqual(calls, ['authorize', 'download', 'install']);
});
