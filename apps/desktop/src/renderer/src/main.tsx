import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
void import('./App').then(({ App }) => {
  root.render(<StrictMode><App /></StrictMode>)
})
