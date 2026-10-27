/// <reference types="vite/client" />

import type { BrowserHostApi, CaptureApi, KnowledgeApi, LayaApi, OldsApi, TranslateApi } from '@intoponet/browser-api'

declare global {
  interface Window {
    intoponet: {
      browserHost: BrowserHostApi
      captures: CaptureApi
      olds: OldsApi
      knowledge: KnowledgeApi
      laya: LayaApi
      translate: TranslateApi
      favicons: { get(hosts: string[]): Promise<Record<string, string>> }
      access: { page(): Promise<{ url: string; title: string; paywalled: boolean; signals: string[]; doi: string | null } | null> }
    }
  }
}

export {}
