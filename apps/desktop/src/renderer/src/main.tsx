import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './brand/brand-tokens.css'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
void import('./App').then(({ App }) => {
  root.render(<StrictMode><App /></StrictMode>)
})
