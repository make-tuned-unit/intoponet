import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { compileProtectionLists } from '../../packages/protection-engine/src/lists'

const listsDir = resolve(__dirname, '../../packages/protection-engine/lists')

/**
 * Puts the public filter lists beside the main process's code (out/main/protection/): the two
 * lists exactly as published, their manifest and attribution, and engine.bin, the lists compiled
 * for the blocker. Compiling here, with the same library the app is built with, means the app
 * reads a ready file at launch (about a millisecond) and never parses the lists' text (about a
 * second). The lists stay separate data files: none of their text is in the app's code.
 */
export function protectionLists(): Plugin {
  return {
    name: 'intoponet-protection-lists',
    buildStart() {
      const manifestText = readFileSync(resolve(listsDir, 'manifest.json'), 'utf8')
      const manifest = JSON.parse(manifestText) as { lists: { file: string; blocks: string; sha256: string }[] }
      const text: Record<string, string> = {}
      for (const list of manifest.lists) {
        const bytes = readFileSync(resolve(listsDir, list.file))
        if (createHash('sha256').update(bytes).digest('hex') !== list.sha256) {
          throw new Error(`${list.file} differs from lists/manifest.json. The lists are never edited by hand: run node scripts/update-protection-lists.mjs.`)
        }
        text[list.blocks] = bytes.toString('utf8')
        this.emitFile({ type: 'asset', fileName: `protection/${list.file}`, source: bytes })
      }
      if (!text.ads || !text.trackers) throw new Error('lists/manifest.json must name one list that blocks ads and one that blocks trackers.')
      this.emitFile({ type: 'asset', fileName: 'protection/engine.bin', source: compileProtectionLists({ ads: text.ads, trackers: text.trackers }) })
      this.emitFile({ type: 'asset', fileName: 'protection/manifest.json', source: manifestText })
      this.emitFile({ type: 'asset', fileName: 'protection/NOTICE.txt', source: readFileSync(resolve(listsDir, 'NOTICE.txt')) })
    },
  }
}
