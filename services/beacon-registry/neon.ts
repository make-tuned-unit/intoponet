import { defineConfig } from '@neon/config/v1'

// Beacon registry on Neon (Atlas Atlantic org, aws-us-east-1). Deploy with:
//   neon deploy --env .env.local
// .env.local must hold BEACON_SECRET (32+ random chars) and BEACON_ADMIN_TOKEN.
export default defineConfig({
  functions: {
    beacons: {
      name: 'Intoponet beacon registry',
      source: 'src/function.ts',
      env: {
        BEACON_SECRET: process.env.BEACON_SECRET!,
        BEACON_ADMIN_TOKEN: process.env.BEACON_ADMIN_TOKEN!,
      },
    },
  },
})
