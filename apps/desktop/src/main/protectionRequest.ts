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
  webContentsId: number
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
  if (webContentsId === undefined) return null
  const tab = tabs.find((item) => item.view.webContents.id === webContentsId)
  if (!tab) return null

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
  return { webContentsId, decision }
}
