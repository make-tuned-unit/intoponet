/// <reference types="vite/client" />

import type { PasswordApi } from '../../shared/passwords'
import type { BeaconApi, BrowserHostApi, BrowsingApi, DownloadsApi, HistoryApi, CaptureApi, KnowledgeApi, LayaApi, OldsApi, PrivacyApi, SitePermissionApi, TranslateApi, UpdatesApi } from '@intoponet/browser-api'

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
      /** Settings › Import from another browser. */
      browserImport: import('../../shared/browserImport').BrowserImportApi
      downloads: DownloadsApi
      history: HistoryApi
      /** Links to other apps, default browser, page appearance. */
      browsing: BrowsingApi
      /** Workspaces and the favourites row. */
      workspaces: import('@intoponet/browser-api').WorkspacesApi
    }
  }
}

export {}
