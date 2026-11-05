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
  // Intoponet can be the Mac's default browser: it claims web links (CFBundleURLTypes) and web
  // pages, PDFs and saved links (CFBundleDocumentTypes), so macOS lists it in Desktop & Dock ›
  // Default web browser and in Finder's Open With. Links and files arrive as open-url/open-file.
  protocols: [
    { name: 'Web site URL', schemes: ['http', 'https'], role: 'Viewer' },
  ],
  fileAssociations: [
    { ext: ['html', 'htm', 'xhtml'], name: 'HTML document', role: 'Viewer', rank: 'Alternate' },
    { ext: 'pdf', name: 'PDF document', role: 'Viewer', rank: 'Alternate' },
    { ext: 'webloc', name: 'Website location', role: 'Viewer', rank: 'Alternate' },
  ],
  mac: {
    // Launch Services looks for the content types too when listing default browsers.
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Web page',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['public.html', 'public.xhtml', 'com.adobe.pdf', 'com.apple.web-internet-location'],
        },
      ],
    },
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
