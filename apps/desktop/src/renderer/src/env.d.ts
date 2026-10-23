/// <reference types="vite/client" />

import type { BrowserHostApi } from '@intoponet/browser-api'

declare global {
  interface Window {
    intoponet: {
      browserHost: BrowserHostApi
    }
  }
}

export {}
