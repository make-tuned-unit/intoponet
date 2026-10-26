import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repo = resolve(__dirname, '../..')
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@intoponet/frequency-field': resolve(repo, 'packages/frequency-field/src/index.ts'),
      '@intoponet/field-snapshot': resolve(repo, 'packages/field-snapshot/src/index.ts'),
      '@intoponet/local-knowledge': resolve(repo, 'packages/local-knowledge/src/index.ts'),
    },
  },
  server: { port: 5199, strictPort: true, fs: { allow: [repo] } },
})
