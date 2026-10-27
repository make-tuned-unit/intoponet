/**
 * Beacons (PRD §4.6): a deliberately published pointer recommending a
 * resource. This package holds the rules shared by the desktop app and the
 * registry: what a beacon may contain, how requests are signed, and how
 * prominence is computed. Nothing here touches the network.
 */
export * from './payload.ts'
export * from './prominence.ts'
export * from './signing.ts'
