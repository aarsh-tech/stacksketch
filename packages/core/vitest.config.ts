import { defineConfig } from 'vitest/config'

// several tests run the TypeScript compiler on generated code, which takes seconds on a busy machine
export default defineConfig({ test: { testTimeout: 30_000 } })
