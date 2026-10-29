import {
  mapElectronResourceType,
  type BlockingDecision,
  type LocalProtectionEngine,
  ProtectionPageContextStore,
} from '@intoponet/protection-engine'

export type ProtectionRequestDetails = {
  id: number
  url: string
  webContentsId?: number
  webContents?: { id: number }
  resourceType: string
  initiatorOrigin?: string
  referrer: string
}

export type ProtectionTab = {
  url: string
  view: { webContents: { id: number; getURL(): string } }
}

export type RoutedProtectionDecision = {
  /** -1 denotes an unattributed Electron request; it is never a real tab ID. */
  webContentsId: number
  topLevelUrl: string | null
  decision: BlockingDecision
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function routeProtectionRequest(
  protection: LocalProtectionEngine,
  pages: ProtectionPageContextStore,
  details: ProtectionRequestDetails,
  tabs: readonly ProtectionTab[],
): RoutedProtectionDecision | null {
  const webContentsId = details.webContentsId ?? details.webContents?.id
  const tab = webContentsId === undefined
    ? undefined
    : tabs.find((item) => item.view.webContents.id === webContentsId)

  if (!tab || webContentsId === undefined) {
    // Electron can omit a tab ID for service-worker and browser-started
    // requests. Use the issuing origin when available (service workers) for
    // first-party and site-pause checks; without one, enforce known host rules
    // without inventing a page context or counter.
    const topLevelUrl = details.initiatorOrigin
      ? safeHttpUrl(details.initiatorOrigin)
      : null
    const decision = protection.evaluate({
      requestUrl: details.url,
      topLevelUrl,
      initiatorOrigin: details.initiatorOrigin ?? details.referrer ?? null,
      resourceType: mapElectronResourceType(details.resourceType),
      profileId: 'default',
      isPrivate: false,
    })
    return { webContentsId: -1, decision, topLevelUrl }
  }

  const pageUrl = tab.view.webContents.getURL() || tab.url
  if (details.resourceType === 'mainFrame') {
    pages.beginNavigation(webContentsId, details.id, details.url)
  } else {
    pages.setCommittedUrl(webContentsId, pageUrl)
  }
  const topLevelUrl = pages.topLevelUrl(webContentsId) ?? safeHttpUrl(pageUrl)
  const decision = protection.evaluate({
    requestUrl: details.url,
    topLevelUrl,
    initiatorOrigin: details.initiatorOrigin ?? details.referrer ?? null,
    resourceType: mapElectronResourceType(details.resourceType),
    profileId: 'default',
    isPrivate: false,
  })
  if (decision.action === 'block' && decision.category) {
    pages.recordBlocked(webContentsId, decision.category)
  }
  return { webContentsId, topLevelUrl, decision }
}
