import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/schibsted-grotesk'
import '@fontsource-variable/jetbrains-mono'

import './panel.css'
import { App } from './App'

// follow the browser's light or dark setting
const media = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => (document.documentElement.dataset.theme = media.matches ? 'dark' : 'light')
applyTheme()
media.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
