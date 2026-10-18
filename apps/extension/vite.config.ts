import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// the side panel; build.mjs bundles the content script and service worker next to it
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // the workbench's primitives and tokens, so the panel looks like the app
      '@': fileURLToPath(new URL('../web/src', import.meta.url)),
    },
  },
  base: './',
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: 'sidepanel.html' } },
})
