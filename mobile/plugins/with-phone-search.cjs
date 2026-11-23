const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const { copyFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

module.exports = config => {
  const packageName = 'com.honmameiko.goodshunter';
  if (config.android?.package !== packageName) throw new Error('Phone search requires the existing Android package.');
  config = withAndroidManifest(config, mod => {
    const app = mod.modResults.manifest.application[0];
    app.activity ??= [];
    if (!app.activity.some(activity => activity.$['android:name'] === '.PhoneSearchActivity')) {
      app.activity.push({ $: { 'android:name': '.PhoneSearchActivity', 'android:exported': 'false' } });
    }
    return mod;
  });
  config = withMainApplication(config, mod => {
    const marker = 'PackageList(this).packages.apply {';
    if (!mod.modResults.contents.includes('add(PhoneSearchPackage())')) {
      if (mod.modResults.contents.split(marker).length !== 2) throw new Error('Phone search: inspect the changed Android template.');
      mod.modResults.contents = mod.modResults.contents.replace(marker, `${marker}\n          add(PhoneSearchPackage())`);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const source = path.join(__dirname, 'phone-search');
    const main = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
    const destination = path.join(main, 'java', ...packageName.split('.'));
    const assets = path.join(main, 'assets');
    await mkdir(destination, { recursive: true });
    await mkdir(assets, { recursive: true });
    await copyFile(path.join(source, 'PhoneSearch.kt'), path.join(destination, 'PhoneSearch.kt'));
    await copyFile(path.join(source, 'surugaya-results.js'), path.join(assets, 'surugaya-results.js'));
    return mod;
  }]);
};
