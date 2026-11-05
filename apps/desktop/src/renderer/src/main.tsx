import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './brand/brand-tokens.css'
import './styles.css'

// A link or file dropped on the app must not load in place of it. Components that accept drops
// (bookmark groups) handle the event first and mark it handled; anything else is refused here.
document.addEventListener('dragover', (event) => {
  if (event.defaultPrevented) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
})
document.addEventListener('drop', (event) => {
  if (!event.defaultPrevented) event.preventDefault()
})

const root = createRoot(document.getElementById('root')!)
void import('./App').then(({ App }) => {
  root.render(<StrictMode><App /></StrictMode>)
})
