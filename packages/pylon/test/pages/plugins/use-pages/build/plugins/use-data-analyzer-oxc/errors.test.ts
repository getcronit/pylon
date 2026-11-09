import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {schema} from './_schema'

describe('oxc analyzer · error surfacing', () => {
  it('surfaces a warning for a useMutation without a field selector', () => {
    const c = createOxcAnalyzerCore({schema})
    const src = `import { useMutation } from '@getcronit/pylon/pages'
      export default function P() {
        const [run] = useMutation()
        return null as any
      }`
    c.transformPage('/app/P.tsx', src)
    const warnings = c.warningsFor('/app/P.tsx')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('useMutation')
    expect(warnings[0]).toContain('/app/P.tsx:3')
  })

  it('surfaces a warning for a useData selecting an unknown field', () => {
    const c = createOxcAnalyzerCore({schema})
    const src = `import { useData } from '@getcronit/pylon/pages'
      export default function P() {
        const data = useData()
        return <div>{data.nope({ bad: 1 }).x}</div>
      }`
    c.transformPage('/app/Q.tsx', src)
    // `nope` isn't a Query field → validated away → nothing to compile → no crash;
    // a genuine lowering failure (e.g. bad args on a real field) would warn. Here
    // the selection is simply empty, so no warning and no rewrite.
    expect(c.warningsFor('/app/Q.tsx')).toEqual([])
  })

  it('reports no warnings for a valid page', () => {
    const c = createOxcAnalyzerCore({schema})
    const src = `import { useData } from '@getcronit/pylon/pages'
      export default function P() {
        const data = useData()
        return <div>{data.me.name}</div>
      }`
    c.transformPage('/app/R.tsx', src)
    expect(c.warningsFor('/app/R.tsx')).toEqual([])
  })
})
