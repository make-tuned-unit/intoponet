/// <reference types="vite/client" />

import type { BrowserHostApi, CaptureApi, KnowledgeApi, OldsApi } from '@intoponet/browser-api'

declare global {
  interface Window {
    intoponet: {
      browserHost: BrowserHostApi
      captures: CaptureApi
      olds: OldsApi
      knowledge: KnowledgeApi
    }
  }
}

export {}
