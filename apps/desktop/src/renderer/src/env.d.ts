/// <reference types="vite/client" />

import type { BeaconApi, BrowserHostApi, CaptureApi, KnowledgeApi, LayaApi, OldsApi, PrivacyApi, SitePermissionApi, TranslateApi, UpdatesApi } from '@intoponet/browser-api'

declare global {
  interface Window {
    intoponet: {
      browserHost: BrowserHostApi
      captures: CaptureApi
      olds: OldsApi
      knowledge: KnowledgeApi
      laya: LayaApi
      translate: TranslateApi
      privacy: PrivacyApi
      sitePermissions: SitePermissionApi
      beacons: BeaconApi
      favicons: { get(hosts: string[]): Promise<Record<string, string>> }
      access: { page(): Promise<{ url: string; title: string; paywalled: boolean; signals: string[]; doi: string | null } | null> }
      updates: UpdatesApi
    }
  }
}

export {}
