const path = require('node:path')

const isRelease = process.env.INTOPONET_MAC_RELEASE === '1'

module.exports = {
  appId: 'com.intoponet.desktop',
  productName: 'Intoponet',
  electronVersion: require(path.resolve(__dirname, '../../node_modules/electron/package.json')).version,
  directories: {
    app: '.',
    output: process.env.INTOPONET_MAC_OUTPUT,
  },
  files: [
    'out/**/*',
    'package.json',
  ],
  extraResources: [
    { from: path.resolve(__dirname, '../../LICENSE'), to: 'LICENSE' },
    { from: path.resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md' },
  ],
  asar: true,
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg'],
    identity: isRelease ? process.env.INTOPONET_MAC_SIGN_IDENTITY : null,
    hardenedRuntime: isRelease,
    entitlements: path.join(__dirname, 'resources/entitlements.mac.plist'),
    entitlementsInherit: path.join(__dirname, 'resources/entitlements.mac.inherit.plist'),
    notarize: isRelease,
  },
  dmg: {
    sign: false,
  },
}
