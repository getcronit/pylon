import {defineConfig} from 'vitest/config'

export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // Integration tests share one Postgres (and the single `_pylon_migrations`
    // ledger) — run files sequentially so they don't race. Unit tests are fast,
    // so serializing everything costs little.
    fileParallelism: false
  }
})
