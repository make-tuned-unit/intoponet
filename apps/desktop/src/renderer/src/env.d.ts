/// <reference types="vite/client" />

import type { BrowserHostApi, CaptureApi } from '@intoponet/browser-api'

declare global {
  interface Window {
    intoponet: {
      browserHost: BrowserHostApi
      captures: CaptureApi
    }
  }
}

export {}
