// Print the place names the app can put a city or regional news feed on, for one or more countries.
// A feed's cityName (local) or regionName (regional) must match one of these exactly (accents/case aside).
// Usage: node scripts/news-place-names.mjs DE FR [--cities 60]
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const { CITY_ROWS, REGION_ROWS, COUNTRY_ROWS } = await import(join(repo, 'apps/desktop/src/shared/places/placeData.ts'))
const args = process.argv.slice(2)
const limitAt = args.indexOf('--cities')
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 40
const codes = args.filter((arg, i) => !arg.startsWith('--') && i !== limitAt + 1).map((code) => code.toUpperCase())
for (const code of codes) {
  const country = COUNTRY_ROWS.find((row) => row[0] === code)
  const regions = REGION_ROWS.filter((row) => row[2] === code).map((row) => row[1])
  const cities = CITY_ROWS.filter((row) => row[2] === code).sort((a, b) => b[6] - a[6]).slice(0, limit).map((row) => `${row[1]} (${row[3]})`)
  console.log(`## ${code} ${country?.[1] ?? '?'}\nregions: ${regions.join('; ')}\ncities (largest ${limit}, with region): ${cities.join('; ')}\n`)
}
