/**
 * The public beacon registry, reached through its edge proxy on the website
 * (Vercel), which supplies a verified network address for per-network limits.
 * The registry itself is a Neon Function (project intoponet-beacons, Atlas
 * Atlantic org, aws-us-east-1) that accepts writes only from that proxy.
 * Settings › Beacons or INTOPONET_BEACON_REGISTRY can point the app elsewhere.
 */
export const DEFAULT_BEACON_REGISTRY = 'https://intoponet.com/registry'

/** Earlier defaults that now refuse writes; a saved copy is treated as "use the default". */
export const RETIRED_BEACON_REGISTRIES: readonly string[] = [
  'https://br-delicate-flower-b7mxmy9q-beacons.compute.c-13.us-east-1.aws.neon.tech',
]
