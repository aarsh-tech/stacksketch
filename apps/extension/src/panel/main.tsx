import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/schibsted-grotesk'
import '@fontsource-variable/jetbrains-mono'

import './panel.css'
import { App } from './App'
import { Grant } from './Grant'

// follow the browser's light or dark setting
const media = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => (document.documentElement.dataset.theme = media.matches ? 'dark' : 'light')
applyTheme()
media.addEventListener('change', applyTheme)

// the same page doubles as the small window that asks to allow an API's host
const grant = new URLSearchParams(location.search).get('grant')

createRoot(document.getElementById('root')!).render(<StrictMode>{grant ? <Grant origin={grant} /> : <App />}</StrictMode>)
