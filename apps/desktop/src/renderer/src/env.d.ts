/// <reference types="vite/client" />

import type { PasswordApi } from '../../shared/passwords'
import type { BeaconApi, BrowserHostApi, DownloadsApi, HistoryApi, CaptureApi, KnowledgeApi, LayaApi, OldsApi, PrivacyApi, SitePermissionApi, TranslateApi, UpdatesApi } from '@intoponet/browser-api'

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
      /** An article's own image, writers, dates and summary (null when the page could not be read). */
      articles: { preview(url: string): Promise<import('../../main/articlePreview').ArticlePreview | null> }
      feedback: {
        status(): Promise<{ due: boolean }>
        later(): Promise<{ due: boolean }>
        never(): Promise<{ due: boolean }>
        send(rating: number | null, comment: string): Promise<{ due: boolean; sent?: boolean }>
      }
      access: { page(): Promise<{ url: string; title: string; paywalled: boolean; signals: string[]; doi: string | null } | null> }
      updates: UpdatesApi
      passwords: PasswordApi
      downloads: DownloadsApi
      history: HistoryApi
    }
  }
}

export {}
