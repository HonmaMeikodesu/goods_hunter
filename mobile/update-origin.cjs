function updateOrigin() {
  const value = process.env.GOODS_HUNTER_UPDATES_ORIGIN?.trim().replace(/\/$/, '');
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error('GOODS_HUNTER_UPDATES_ORIGIN must be a canonical HTTPS origin');
  }
  return url.origin;
}

module.exports = { updateOrigin };
