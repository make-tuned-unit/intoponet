import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const frequencyField = resolve(__dirname, '../../packages/frequency-field/src/index.ts')
const fieldSnapshot = resolve(__dirname, '../../packages/field-snapshot/src/index.ts')
const localKnowledge = resolve(__dirname, '../../packages/local-knowledge/src/index.ts')
const workspacePackages = [
  '@intoponet/browser-api',
  '@intoponet/field-snapshot',
  '@intoponet/frequency-field',
  '@intoponet/local-knowledge',
  '@intoponet/protection-engine',
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
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
    plugins: [react()],
  },
})
