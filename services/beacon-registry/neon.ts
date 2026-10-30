import { defineConfig } from '@neon/config/v1'

// Beacon registry on Neon (Atlas Atlantic org, aws-us-east-1). Deploy with:
//   neon deploy --env .env.local
// .env.local must hold BEACON_SECRET (32+ random chars), BEACON_ADMIN_TOKEN and
// BEACON_EDGE_SECRET (32+ random chars, also set on the Vercel edge proxy).
// BEACON_PUBLISH_PAUSED ("0" or "1") is optional and only written when present.
export default defineConfig({
  functions: {
    beacons: {
      name: 'Intoponet beacon registry',
      source: 'src/function.ts',
      env: {
        BEACON_SECRET: process.env.BEACON_SECRET!,
        BEACON_ADMIN_TOKEN: process.env.BEACON_ADMIN_TOKEN!,
        BEACON_EDGE_SECRET: process.env.BEACON_EDGE_SECRET!,
        ...(process.env.BEACON_PUBLISH_PAUSED ? { BEACON_PUBLISH_PAUSED: process.env.BEACON_PUBLISH_PAUSED } : {}),
      },
    },
  },
  triggers: {
    'beacon-retention': {
      type: 'schedule',
      function: 'beacons',
      cron: '17 4 * * *',
      functionPath: '/internal/purge',
    },
  },
})
