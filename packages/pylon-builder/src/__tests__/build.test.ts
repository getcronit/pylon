import {describe, test} from '@jest/globals'

import {build} from '../index.js'

describe('Build', () => {
  test('Build example', async () => {
    await build({
      sfiFilePath: './src/__tests__/__fixtures__/example/src/sfi.ts',
      outputFilePath: './src/__tests__/__fixtures__/example/.cache/sfi.js'
    })
  })
})
