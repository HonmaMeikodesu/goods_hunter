import type { ConfigContext, ExpoConfig } from 'expo/config';

const { updateOrigin } = require('./update-origin.cjs') as { updateOrigin: () => string | undefined };
const origin = updateOrigin();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '谷子猎手',
  slug: 'goods-hunter',
  runtimeVersion: process.env.GOODS_HUNTER_RUNTIME_VERSION || { policy: 'fingerprint' },
  extra: { ...config.extra, updatesOrigin: origin },
  updates: origin ? {
    url: `${origin}/api/mobile/updates/manifest`,
    checkAutomatically: 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: './updates-certificate.pem',
    codeSigningMetadata: { keyid: 'goods-hunter-root', alg: 'rsa-v1_5-sha256' },
  } : { enabled: false },
});
