import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {schema} from './_schema'

const page = (extra = '') =>
  `import { useData } from '@getcronit/pylon/pages'
   export default function P() {
     const data = useData()
     return <div>{data.me.name}${extra}</div>
   }`

/**
 * `reuseResults` (production build only): the paired server + client passes analyze
 * the same frozen source, so the second pass reuses the first's compiled result and
 * only re-wires the virtual sidecar — no re-analysis. Content-hash keyed, so any
 * source change recomputes.
 */
describe('oxc analyzer · build result reuse', () => {
  it('reuses the compiled result for a byte-identical second pass (server → client)', () => {
    const core = createOxcAnalyzerCore({schema, reuseResults: true})
    const id = '/app/P.tsx'
    const src = page()

    core.start() // server build
    const first = core.transformPage(id, src)
    const firstSidecar = core.loadSidecar('\0pylon-docs:' + id)

    core.start() // client build (shared core)
    const second = core.transformPage(id, src)
    const secondSidecar = core.loadSidecar('\0pylon-docs:' + id)

    expect(first).toBeTruthy()
    expect(first).toContain('__pylonDoc_P_0') // rewritten to reference the compiled doc
    expect(firstSidecar).toContain('me { name') // the compiled document lives in the sidecar
    // Byte-identical rewrite + sidecar on the reused pass.
    expect(second).toBe(first)
    expect(secondSidecar).toBe(firstSidecar)
  })

  it('recomputes when the source changes (content-hash keyed, never stale)', () => {
    const core = createOxcAnalyzerCore({schema, reuseResults: true})
    const id = '/app/P.tsx'

    core.start()
    core.transformPage(id, page())
    const aSidecar = core.loadSidecar('\0pylon-docs:' + id)
    // A different read on the same page → the cache key changes → recompute.
    core.transformPage(id, page('{data.me.email}'))
    const bSidecar = core.loadSidecar('\0pylon-docs:' + id)

    expect(aSidecar).toContain('me { name')
    expect(aSidecar).not.toContain('email')
    expect(bSidecar).toContain('email')
  })
})
