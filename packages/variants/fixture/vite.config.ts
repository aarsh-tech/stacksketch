import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { stacksketchVariants } from '../dist/vite.js'

// a tiny app to try the plugin on: pnpm --filter @stacksketch/variants fixture, then open /__variants
export default defineConfig({
  plugins: [react(), stacksketchVariants({ setup: ['/src/theme.css'] })],
  server: { port: 5190 },
})
