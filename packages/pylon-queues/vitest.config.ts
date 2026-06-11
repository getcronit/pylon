import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // Integration tests share one Redis — run files sequentially.
    fileParallelism: false
  }
})
