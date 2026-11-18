import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildPage } from './build.mjs'

const snippet = readFileSync(new URL('./permagent.js', import.meta.url), 'utf8')

for (const page of ['index.html', 'beacon-policy.html', '404.html', 'ideas.html', 'publishers.html']) {
  test(`${page}: the snippet is inlined once and the page policy allows exactly it`, () => {
    const built = buildPage(readFileSync(new URL(`./${page}`, import.meta.url), 'utf8'), snippet)
    assert.equal(built.split('window.permagent.v = 2;').length, 2)
    assert.equal(built.split('"/api/permagent-analytics/collect"').length, 2)
    assert.ok(!built.includes('<script src="/permagent.js">'))
    const inline = [...built.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    assert.equal(inline.length, 1)
    const hash = createHash('sha256').update(inline[0], 'utf8').digest('base64')
    const policy = built.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1]
    assert.ok(policy?.includes(`script-src 'self' 'sha256-${hash}'`), policy)
    assert.ok(built.indexOf('http-equiv="Content-Security-Policy"') < built.indexOf('<script'), 'policy precedes every script')
    assert.ok(built.indexOf('window.permagent.v') < built.indexOf('</head>'), 'snippet is in <head>')
  })
}

test('a page that already inlines the snippet is refused rather than doubled', () => {
  assert.throws(() => buildPage(`<head><script>window.permagent.v</script><script src="/permagent.js"></script></head>`, snippet))
  assert.throws(() => buildPage('<head></head>', snippet))
})
