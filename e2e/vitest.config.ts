import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./global-setup.ts'],
    // DB-using e2e tests share one Postgres — run files sequentially to avoid
    // cross-test interference.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000
  }
})
