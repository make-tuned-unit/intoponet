export type {
  BlockingCategory,
  BlockingDecision,
  CategoryToggles,
  CompiledRule,
  ProtectionAdapter,
  ProtectionSnapshot,
  RequestContext,
  ResourceType,
} from './types'
export { fixtureHideSelectors, fixtureRules } from './fixtures'
export { blocklistEntries, blocklistMeasurement, blocklistSummary, defaultRules } from './blocklist'
export type { BlocklistEntry } from './blocklist'
export { LocalProtectionEngine, mapElectronResourceType } from './engine'
export { sameSite, siteOfHost } from './site'
export { ProtectionPageContextStore } from './page-context'
export type { PageProtectionCounters } from './page-context'
