import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '谷子猎手',
  slug: 'goods-hunter',
  runtimeVersion: process.env.GOODS_HUNTER_RUNTIME_VERSION || { policy: 'fingerprint' },
  updates: {
    url: 'https://hunter.example.invalid/api/mobile/updates/manifest',
    checkAutomatically: 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: './updates-certificate.pem',
    codeSigningMetadata: { keyid: 'goods-hunter-root', alg: 'rsa-v1_5-sha256' },
  },
});
