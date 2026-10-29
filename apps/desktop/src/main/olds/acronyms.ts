/** Resolve an initialism only from an explicit "Full Name (ABC)" statement in public
 * Wikipedia search snippets. Do not infer the meaning from an unrelated search title. */
export function expansionFromSnippets(acronym: string, hits: Array<{ title?: string; snippet?: string }>): { name: string; source: string } | null {
  if (!/^[A-Z]{3,8}$/.test(acronym)) return null
  const found = new Map<string, string>()
  for (const hit of hits) {
    if (!hit.title || !hit.snippet) continue
    const text = hit.snippet.replace(/<[^>]*>/g, '').replace(/&(?:#39|apos);/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ')
    const pattern = new RegExp(`((?:[A-Za-z][A-Za-z'-]*\\s+){2,12})\\(${acronym}\\)`, 'g')
    for (const match of text.matchAll(pattern)) {
      const words = match[1]!.trim().split(/\s+/)
      for (let at = 0; at < words.length; at += 1) {
        const name = words.slice(at)
        const content = name.filter((word) => !/^(of|the|and|for|in|on)$/i.test(word))
        if (!/^[A-Z]/.test(name[0]!) || content.some((word) => !/^[A-Z]/.test(word))) continue
        if (content.map((word) => word[0]).join('') !== acronym) continue
        found.set(name.join(' '), hit.title)
      }
    }
  }
  if (found.size !== 1) return null
  const [name, source] = [...found][0]!
  return { name, source }
}
