import {describe, expect, test} from '@jest/globals'

import {Bundler} from '../bundler/bundler.js'

describe('Bundler', () => {
  test('Bundle example', () => {
    const bundler = new Bundler(
      './src/__tests__/__fixtures__/example/src/sfi.ts',
      './src/__tests__/__fixtures__/example/.cache/bundle-sfi.js'
    )

    expect(bundler).toBeDefined()

    bundler.build({getTypeDefs: () => 'type Query { hello: String }'})
  })
})
