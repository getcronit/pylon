import {afterEach, describe, expect, it, vi} from 'vitest'

import {runWithAppContext} from '../src/app-context'
import {noteQuery} from '../src/n-plus-one'

// Core advisory logic — no DB. Fed (model, op) directly; the DB-backed batching
// behaviour is covered by test/integration/n-plus-one.test.ts.
describe('n+1 advisory (unit)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns ONCE past the threshold in one request, in ORM terms', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runWithAppContext({}, () => {
      for (let i = 0; i < 20; i++) noteQuery({name: 'Variant'}, 'all')
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[pylon-db:n+1]')
    expect(warn.mock.calls[0][0]).toContain('Variant.all()')
  })

  it('does NOT warn below the threshold', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runWithAppContext({}, () => {
      for (let i = 0; i < 5; i++) noteQuery({name: 'Variant'}, 'all')
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('is scoped PER request — separate contexts do not merge counts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let r = 0; r < 3; r++)
      runWithAppContext({}, () => {
        for (let i = 0; i < 6; i++) noteQuery({name: 'X'}, 'all') // 6 < 12 each
      })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores queries outside a request (CLI/seed/startup)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 50; i++) noteQuery({name: 'X'}, 'all')
    expect(warn).not.toHaveBeenCalled()
  })
})
