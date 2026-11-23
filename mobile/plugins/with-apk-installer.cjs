const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const { mkdir, copyFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

module.exports = config => {
  const packageName = 'com.honmameiko.goodshunter';
  if (config.android?.package !== packageName) throw new Error('APK installer requires the existing package.');
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ??= [];
    if (!manifest['uses-permission'].some(item => item.$['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES')) {
      manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES' } });
    }
    const app = manifest.application[0];
    app.provider = (app.provider ?? []).filter(item => item.$['android:name'] !== '.ApkFileProvider');
    app.provider.push({ $: { 'android:name': '.ApkFileProvider', 'android:authorities': `${packageName}.apk-updates`,
      'android:exported': 'false', 'android:grantUriPermissions': 'true' },
      'meta-data': [{ $: { 'android:name': 'android.support.FILE_PROVIDER_PATHS', 'android:resource': '@xml/apk_update_paths' } }] });
    return mod;
  });
  config = withMainApplication(config, mod => {
    const marker = 'PackageList(this).packages.apply {';
    if (!mod.modResults.contents.includes('add(ApkInstallerPackage())')) {
      if (mod.modResults.contents.split(marker).length !== 2) throw new Error('APK installer: inspect the changed Android template.');
      mod.modResults.contents = mod.modResults.contents.replace(marker, `${marker}\n          add(ApkInstallerPackage())`);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const android = mod.modRequest.platformProjectRoot;
    const destination = path.join(android, 'app/src/main/java', ...packageName.split('.'));
    await mkdir(destination, { recursive: true });
    for (const file of ['ApkPayload.kt', 'ApkInstaller.kt']) await copyFile(path.join(__dirname, 'apk-installer', file), path.join(destination, file));
    const xml = path.join(android, 'app/src/main/res/xml'); await mkdir(xml, { recursive: true });
    await writeFile(path.join(xml, 'apk_update_paths.xml'), '<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="apk_updates" path="apk-updates/" /></paths>\n');
    return mod;
  }]);
};
