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
export { LocalProtectionEngine, mapElectronResourceType } from './engine'
export { ProtectionPageContextStore } from './page-context'
export type { PageProtectionCounters } from './page-context'
