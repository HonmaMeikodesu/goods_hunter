module.exports = {
  extraSources: [
    { type: 'dir', filePath: 'plugins', reasons: ['goods-hunter-native-plugins'] },
    { type: 'file', filePath: 'with-local-http.cjs', reasons: ['goods-hunter-network-policy'] },
    { type: 'file', filePath: 'update-origin.cjs', reasons: ['goods-hunter-update-origin'] },
    { type: 'file', filePath: 'updates-certificate.pem', reasons: ['goods-hunter-update-certificate'] },
  ],
};
