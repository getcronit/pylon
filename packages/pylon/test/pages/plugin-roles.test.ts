/**
 * `usePages` is scoped to the WEB role. Combined with the executeConfig role gate (see
 * test/app/role-gate.test.ts), this is what guarantees the worker process never runs
 * usePages' `setup` — so its lazy `import('./setup')` (which pulls react-dom/server,
 * react-router, pylon-query and reads the page manifests) never loads in a worker.
 */
import {describe, expect, it} from 'vitest'
import {usePages} from '@/pages/plugins/use-pages'

describe('usePages plugin role', () => {
  it('is web-only (roles: ["web"]) so a worker skips it entirely', () => {
    expect(usePages().roles).toEqual(['web'])
  })
})
