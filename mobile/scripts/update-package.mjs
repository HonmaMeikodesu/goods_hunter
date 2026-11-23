import { createHash, randomUUID, sign, verify, X509Certificate } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

export async function saveJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}

export async function packageHotUpdate({ directory, exportDirectory, config, serviceUrl, privateKey, certificate, notes, now = new Date() }) {
  const cert = new X509Certificate(certificate);
  if (cert.ca || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.3')) throw new Error('A leaf code-signing certificate is required');
  const runtime = config.runtimeVersion;
  if (typeof runtime !== 'string' || !/^[a-f0-9]{40,64}$/.test(runtime)) throw new Error('Resolved native runtime is required');
  const metadata = JSON.parse(await readFile(join(exportDirectory, 'metadata.json'), 'utf8'));
  const android = metadata.fileMetadata?.android;
  if (!android?.bundle || !Array.isArray(android.assets)) throw new Error('Missing Android export');
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json' };
  async function asset(path, extension, launch = false) {
    const file = resolve(exportDirectory, path);
    if (!file.startsWith(resolve(exportDirectory) + sep)) throw new Error('Export asset outside export directory');
    const bytes = await readFile(file);
    const digest = createHash('sha256').update(bytes).digest();
    const name = digest.toString('hex');
    await mkdir(join(directory, 'assets'), { recursive: true });
    await copyFile(file, join(directory, 'assets', name));
    return { hash: digest.toString('base64url'), key: launch ? name : basename(path, extname(path)),
      contentType: launch ? 'application/javascript' : types[extension] ?? 'application/octet-stream',
      ...(launch ? {} : { fileExtension: `.${extension}` }), url: `${serviceUrl}/api/mobile/updates/assets/${name}` };
  }
  const launchAsset = await asset(android.bundle, 'hbc', true);
  const assets = [];
  for (const item of android.assets) assets.push(await asset(item.path, item.ext));
  const manifest = JSON.stringify({ id: randomUUID(), createdAt: now.toISOString(), runtimeVersion: runtime,
    launchAsset, assets, metadata: {}, extra: { expoClient: config, goodsHunterUpdate: { notes } } });
  const signature = sign('sha256', Buffer.from(manifest), privateKey).toString('base64');
  if (!verify('sha256', Buffer.from(manifest), certificate, Buffer.from(signature, 'base64'))) throw new Error('Update signing key does not match embedded certificate');
  const file = join(directory, 'manifests', `${runtime}.json`);
  const previous = await readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous && JSON.parse(previous.manifest).createdAt >= now.toISOString()) throw new Error('Update timestamp must be newer than the published update');
  const envelope = { manifest, signature };
  await saveJson(file, envelope);
  return envelope;
}

export async function verifyPublishedUpdate({ directory, serviceUrl, runtime, certificate }) {
  const get = (url, headers = {}) => fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  const latest = await get(`${serviceUrl}/api/mobile/updates/latest`);
  if (!latest.ok) throw new Error('Published native version unavailable');
  const remote = await latest.json();
  const expected = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
  for (const key of Object.keys(expected)) if (remote[key] !== expected[key]) throw new Error('Published native version differs from the release');
  const headers = { 'expo-protocol-version': '1', 'expo-platform': 'android', 'expo-runtime-version': runtime,
    accept: 'application/expo+json', 'expo-expect-signature': 'sig, keyid="goods-hunter-root", alg="rsa-v1_5-sha256"' };
  const response = await get(`${serviceUrl}/api/mobile/updates/manifest`, headers);
  const local = await readFile(join(directory, 'manifests', `${runtime}.json`), 'utf8').then(JSON.parse)
    .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!local) {
    if (response.status !== 204) throw new Error('Unexpected update for a runtime without a publication');
    return { runtime, hotUpdate: null, assets: 0 };
  }
  if (!response.ok) throw new Error(`Update manifest returned ${response.status}`);
  const body = await response.text();
  const signature = response.headers.get('expo-signature')?.match(/sig="([^"]+)"/)?.[1];
  if (body !== local.manifest || !signature || !verify('sha256', Buffer.from(body), certificate, Buffer.from(signature, 'base64'))) throw new Error('Published update signature or content is invalid');
  const manifest = JSON.parse(body);
  const multipart = await get(`${serviceUrl}/api/mobile/updates/manifest`, { ...headers, accept: 'multipart/mixed' });
  if (!multipart.ok || !(multipart.headers.get('content-type') ?? '').includes('multipart/mixed')
    || !(await multipart.text()).includes(`\r\n\r\n${body}\r\n`)) throw new Error('Native multipart response is invalid');
  for (const asset of [manifest.launchAsset, ...manifest.assets]) {
    if (!asset.url.startsWith(`${serviceUrl}/api/mobile/updates/assets/`)) throw new Error('Unexpected asset service');
    const response = await get(asset.url);
    if (!response.ok || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('base64url') !== asset.hash) throw new Error('Published asset is unavailable or corrupted');
  }
  const otherRuntime = (runtime.startsWith('f') ? 'e' : 'f') + runtime.slice(1);
  const incompatible = await get(`${serviceUrl}/api/mobile/updates/manifest`, { ...headers, 'expo-runtime-version': otherRuntime });
  if (incompatible.status !== 204) throw new Error('Server must not send updates to an incompatible runtime');
  return { runtime, hotUpdate: manifest.id, assets: manifest.assets.length + 1 };
}
