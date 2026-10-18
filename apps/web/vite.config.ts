import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5174 },
  preview: { port: 4174 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'codemirror', test: /node_modules[\\/](@codemirror|@lezer|@uiw)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
