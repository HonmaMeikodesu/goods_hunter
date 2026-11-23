const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = function withLocalHTTP(config) {
  config = withAndroidManifest(config, result => {
    const application = result.modResults.manifest.application[0].$;
    application['android:usesCleartextTraffic'] = 'false';
    application['android:networkSecurityConfig'] = '@xml/network_security_config';
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const directory = join(result.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'network_security_config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>`);
    return result;
  }]);
};
