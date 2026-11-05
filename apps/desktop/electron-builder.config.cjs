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
  // Electron fuses (flipped in the binary before signing). Without these, any local program could
  // start the app as plain Node or with --inspect / NODE_OPTIONS and use its Keychain access to
  // decrypt saved passwords and the private library. grantFileProtocolExtraPrivileges stays on:
  // the shell loads its module scripts from file://, which needs it (moving it to a custom scheme
  // would change its storage origin).
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: true,
    // Unsigned previews: re-sign ad hoc after flipping fuses, or Apple silicon refuses to launch them.
    resetAdHocDarwinSignature: !isRelease,
  },
  mac: {
    icon: path.join(__dirname, 'resources/Intoponet.icns'),
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    // electron-builder expects the certificate name without its type prefix.
    identity: isRelease ? process.env.INTOPONET_MAC_SIGN_IDENTITY.replace(/^Developer ID Application: /, '') : null,
    hardenedRuntime: isRelease,
    entitlements: path.join(__dirname, 'resources/entitlements.mac.plist'),
    entitlementsInherit: path.join(__dirname, 'resources/entitlements.mac.inherit.plist'),
    notarize: isRelease,
  },
  dmg: {
    sign: false,
  },
}
