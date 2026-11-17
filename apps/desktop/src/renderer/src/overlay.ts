// The address bar's suggestions as floated above a page (main/shellOverlay.ts). The app window's list is the real one
// (it has the keyboard and is what assistive technology reads); this is its picture, drawn where a page would hide it.
// Main hands over the list's markup; a click on a row is told to main as an address this page asks for and never gets.
// The app window's own styles, taken as text: imported as stylesheets they would be shared with the app window's
// bundle, which changes the order its rules load in (the Highlights panel lost its place that way).
import inter from '@fontsource-variable/inter/opsz.css?inline'
import tokens from './brand/brand-tokens.css?inline'
import base from './styles.css?inline'
import glass from './glass/glass.css?inline'
import omnibox from './omnibox.css?inline'
import own from './overlay.css?inline'

// One sheet made here, the copy's own rules last: nothing waits on a stylesheet to load, in a build or from the dev
// server (whose injected style elements this page's policy refuses).
const sheet = new CSSStyleSheet()
sheet.replaceSync([inter, tokens, base, glass, omnibox, own].join('\n'))
document.adoptedStyleSheets = [sheet]

const host = document.getElementById('shell-overlay')!

declare global {
  interface Window { __intoponetOverlay?: (html: string) => void }
}

// An empty string clears it (when the list closes), so the next list never opens showing the last one.
window.__intoponetOverlay = (html) => {
  // Parsed inert first: only the list itself is kept, without the styles its opening animation had mid-flight.
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const list = parsed.querySelector('ul.omnibox-suggestions')
  host.replaceChildren()
  if (!list) return
  list.removeAttribute('style')
  list.removeAttribute('id')
  for (const el of list.querySelectorAll('[id]')) el.removeAttribute('id')
  host.append(document.importNode(list, true))
}

host.addEventListener('mousedown', (event) => {
  // Kept from taking a text selection or the keyboard's place in the list.
  event.preventDefault()
})

host.addEventListener('click', (event) => {
  const row = (event.target as Element | null)?.closest('li.omnibox-row')
  if (!row || !row.parentElement) return
  const index = [...row.parentElement.children].indexOf(row)
  if (index < 0) return
  const keys = new URLSearchParams()
  if (event.metaKey) keys.set('meta', '1')
  if (event.altKey) keys.set('alt', '1')
  const query = keys.toString()
  window.location.href = `intoponet-overlay:pick/${index}${query ? `?${query}` : ''}`
})
