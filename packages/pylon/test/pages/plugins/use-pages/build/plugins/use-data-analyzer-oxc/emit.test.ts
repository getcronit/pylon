import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {schema} from './_schema'

const core = () => createOxcAnalyzerCore({schema})

const PAGE = `import { useData } from '@getcronit/pylon/pages'
export default function Page() {
  const data = useData()
  return <div>{data.user({ id: "1" }).email}{data.me.name}</div>
}
`

describe('oxc analyzer · sidecar emit + adapter core', () => {
  it('rewrites the call and imports the doc from a per-page sidecar', () => {
    const c = core()
    const out = c.transformPage('/app/Page.tsx', PAGE)!
    expect(out).toBeTruthy()
    // sidecar import prepended
    expect(out).toContain(`from "pylon-docs:/app/Page.tsx"`)
    // the useData() call now references the compiled doc + inline thunk
    expect(out).toMatch(/useData\(__pylonDoc_Page_0, \(\) => \(\{[^}]*\}\)\)/)
    // the original selector expressions remain in the render body
    expect(out).toContain('data.user({ id: "1" }).email')
  })

  it('serves the sidecar as a virtual module with the compiled document', () => {
    const c = core()
    c.transformPage('/app/Page.tsx', PAGE)
    const virtualId = c.resolveSidecar('pylon-docs:/app/Page.tsx')
    expect(virtualId).toBe('\0pylon-docs:/app/Page.tsx')
    const sidecar = c.loadSidecar(virtualId!)!
    expect(sidecar).toContain(`import { doc } from '@getcronit/pylon/query'`)
    // Plain JS (no TS generic) — the sidecar is a `\0` virtual module Vite won't
    // TS-transform, so a generic would ship raw TS to the browser.
    expect(sidecar).toContain('export const __pylonDoc_Page_0 = doc({')
    expect(sidecar).not.toContain('doc<')
    expect(sidecar).toContain('user(id: $v0)')
    expect(sidecar).toContain('me { name')
  })

  it('preserves existing useData options as a trailing argument', () => {
    const c = core()
    const src = `import { useData } from '@getcronit/pylon/pages'
      export default function P() {
        const data = useData({ tags: ["x"] })
        return <span>{data.me.email}</span>
      }`
    const out = c.transformPage('/app/P.tsx', src)!
    expect(out).toMatch(/useData\(__pylonDoc_P_0, undefined, \{ tags: \["x"\] \}\)/)
  })

  it('skips files that do not use the hook', () => {
    const c = core()
    expect(c.transformPage('/app/plain.ts', `export const x = 1`)).toBeNull()
  })

  it('numbers multiple seeds in source order', () => {
    const c = core()
    const src = `import { useData } from '@getcronit/pylon/pages'
      export default function P() {
        const a = useData()
        const b = useData()
        return <span>{a.me.name}{b.me.email}</span>
      }`
    const out = c.transformPage('/app/Multi.tsx', src)!
    expect(out).toContain('__pylonDoc_Multi_0')
    expect(out).toContain('__pylonDoc_Multi_1')
    const sidecar = c.loadSidecar('\0pylon-docs:/app/Multi.tsx')!
    expect(sidecar).toContain('me { name')
    expect(sidecar).toContain('me { email')
  })
})
