import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const assets = resolve(__dirname, '../../assets')
const repo = resolve(__dirname, '../../../../../..')
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

/** The fields of a .license file: "Name: value", with indented lines continuing the value. */
function record(file: string): Map<string, string> {
  const fields = new Map<string, string>()
  let last = ''
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const field = /^([A-Za-z0-9-]+): (.*)$/.exec(line)
    if (field) {
      last = field[1]!
      fields.set(last, field[2]!)
    } else if (last && /^\s+\S/.test(line)) fields.set(last, `${fields.get(last)} ${line.trim()}`)
    else last = ''
  }
  return fields
}

describe('the Earth textures are the files their provenance records', () => {
  const buildScript = readFileSync(resolve(repo, 'scripts/build-earth-textures.mjs'), 'utf8')

  for (const name of ['earth-day.jpg', 'earth-night.jpg']) {
    it(`${name} has a record beside it, and is the file the record describes`, () => {
      const fields = record(resolve(assets, `${name}.license`))
      const shipped = sha256(resolve(assets, name))
      expect(fields.get('Output-SHA256')).toBe(shipped)
      expect(fields.get('Source-SHA256')).toMatch(/^[0-9a-f]{64}$/)
      expect(fields.get('Source-URL')).toMatch(/^https:\/\/assets\.science\.nasa\.gov\//)
      expect(fields.get('Source-Page')).toMatch(/^https:\/\/science\.nasa\.gov\//)
      expect(fields.get('Retrieved')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(fields.get('Processing')).toContain(`sips -s format jpeg -s formatOptions 72 -z 2048 4096`)
      expect(fields.get('Processing')).toContain(`--out ${name}`)
      expect(fields.get('Credit')).toContain('NASA Earth Observatory')
      expect(fields.get('Endorsement')).toBe('NASA does not endorse Intoponet.')
      // The script that makes the textures records the same two checksums and the same original.
      expect(buildScript).toContain(shipped)
      expect(buildScript).toContain(fields.get('Source-SHA256')!)
      expect(buildScript).toContain(fields.get('Source-URL')!)
      // A JPEG, 4096 by 2048 (the first frame header gives height then width).
      const bytes = readFileSync(resolve(assets, name))
      const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]))
      expect(frame).toBeGreaterThan(0)
      expect([bytes.readUInt16BE(frame + 5), bytes.readUInt16BE(frame + 7)]).toEqual([2048, 4096])
    })
  }

  it('NASA imagery is not called public domain where the app and its notices credit it', () => {
    const settings = readFileSync(resolve(__dirname, '../settings/SettingsPanel.tsx'), 'utf8')
    const credit = settings.split('\n').find((line) => line.includes('NASA Earth Observatory'))
    expect(credit).toBeDefined()
    expect(credit).toContain('NASA does not endorse Intoponet')
    expect(credit).not.toMatch(/public domain/i)
    const notices = readFileSync(resolve(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    for (const row of notices.split('\n').filter((line) => /^\| `apps\/desktop\/src\/renderer\/assets\/earth-(day|night)\.jpg`/.test(line))) {
      expect(row).not.toContain('Public domain')
      expect(row).toContain('https://science.nasa.gov/earth/earth-observatory/')
      expect(row).not.toMatch(/earthobservatory\.nasa\.gov|visibleearth\.nasa\.gov/)
    }
    expect(notices).toContain('NASA does not endorse Intoponet')
  })
})
