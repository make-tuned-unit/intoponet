import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { protectionLists } from './protectionListsPlugin'
import { withDevShellPolicy } from './src/renderer/shellPolicy'

const updateUrlInput = process.env.INTOPONET_MAC_UPDATE_URL ?? ''
const updateUrl = updateUrlInput
  ? (() => {
      const url = new URL(updateUrlInput)
      if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || url.search || url.hash || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') || /^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(':') || (url.port && url.port !== '443')) {
        throw new Error('INTOPONET_MAC_UPDATE_URL must be a trusted HTTPS origin/path without credentials, query, or fragment')
      }
      return url.toString().replace(/\/$/, '')
    })()
  : ''

/** The shell's Content-Security-Policy (src/renderer/index.html), with what the dev server needs added in development only. */
const devShellPolicy: Plugin = {
  name: 'intoponet-dev-shell-policy',
  apply: 'serve',
  transformIndexHtml: { order: 'pre', handler: (html) => withDevShellPolicy(html) },
}

const frequencyField = resolve(__dirname, '../../packages/frequency-field/src/index.ts')
const fieldSnapshot = resolve(__dirname, '../../packages/field-snapshot/src/index.ts')
const localKnowledge = resolve(__dirname, '../../packages/local-knowledge/src/index.ts')
const workspacePackages = [
  '@intoponet/browser-api',
  '@intoponet/beacon-core',
  '@intoponet/field-snapshot',
  '@intoponet/frequency-field',
  '@intoponet/local-knowledge',
  '@intoponet/protection-engine',
]

export default defineConfig({
  main: {
    define: { __INTOPONET_MAC_UPDATE_URL__: JSON.stringify(updateUrl) },
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages }), protectionLists()],
    // The adblocker library (MPL-2.0) stays in a file of its own, apart from Intoponet's code (THIRD_PARTY_NOTICES.md §1).
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => (/node_modules\/(@ghostery|@remusao|tldts-experimental|tldts-core)\//.test(id) ? 'adblocker' : undefined),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    // index: the app shell. page: the sign-in helper for web pages (no shared chunks: sandboxed preloads are one file).
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          page: resolve(__dirname, 'src/preload/page.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@intoponet/frequency-field': frequencyField,
        '@intoponet/field-snapshot': fieldSnapshot,
        '@intoponet/local-knowledge': localKnowledge,
      },
    },
    plugins: [react(), devShellPolicy],
    // Minified: the app shell parses about half as much script at every launch.
    // index: the app window. overlay: the address bar's suggestions as floated above a page (main/shellOverlay.ts).
    build: {
      minify: 'esbuild',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), overlay: resolve(__dirname, 'src/renderer/overlay.html') } },
    },
  },
})
