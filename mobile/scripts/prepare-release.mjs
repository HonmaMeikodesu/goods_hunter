import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageHotUpdate, saveJson } from './update-package.mjs';

const [kind, output, input, runtime, notes = ''] = process.argv.slice(2);
const origin = 'https://hunter.example.invalid';
if (!['apk', 'hot'].includes(kind) || !output || !input || !/^[a-f0-9]{40,64}$/.test(runtime ?? '') || notes.length > 2000) {
  throw new Error('Usage: node scripts/prepare-release.mjs apk|hot <publication-dir> <apk-or-export-dir> <runtime> [notes]');
}
const config = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8')).expo;
const project = fileURLToPath(new URL('../', import.meta.url));
const fingerprintEnv = { ...process.env };
delete fingerprintEnv.GOODS_HUNTER_RUNTIME_VERSION;
const { runtimeVersion } = JSON.parse(execFileSync(process.execPath, [
  'node_modules/expo-updates/bin/cli.js', 'runtimeversion:resolve', '--platform', 'android', '--workflow', 'managed',
], { cwd: project, env: fingerprintEnv, encoding: 'utf8' }));
if (runtimeVersion !== runtime) throw new Error('The native fingerprint does not match this source tree');
const latest = join(output, 'latest.json');
const current = await readFile(latest, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});

if (kind === 'apk') {
  const apk = await readFile(input);
  const sha256 = createHash('sha256').update(apk).digest('hex');
  if (current && (config.android.versionCode < current.versionCode ||
      (config.android.versionCode === current.versionCode && sha256 !== current.sha256))) {
    throw new Error('A changed APK requires a higher versionCode');
  }
  await mkdir(join(output, 'apks'), { recursive: true });
  await copyFile(input, join(output, 'apks', `${sha256}.apk`));
  await saveJson(latest, { version: config.version, versionCode: config.android.versionCode,
    runtimeVersion: runtime, sha256, bytes: apk.length, notes });
  console.log(`Prepared APK ${config.version} · ${apk.length} bytes · ${sha256}`);
} else {
  if (!current || current.runtimeVersion !== runtime) throw new Error('This native runtime has no published APK');
  const keyFile = process.env.GOODS_HUNTER_UPDATES_KEY;
  if (!keyFile) throw new Error('Set GOODS_HUNTER_UPDATES_KEY to the local code-signing private key');
  const privateKey = await readFile(keyFile);
  const certificate = await readFile(new URL('../updates-certificate.pem', import.meta.url));
  const result = await packageHotUpdate({ directory: output, exportDirectory: input,
    config: { ...config, runtimeVersion: runtime }, serviceUrl: origin, privateKey, certificate, notes });
  console.log(`Prepared signed update ${JSON.parse(result.manifest).id}`);
}
