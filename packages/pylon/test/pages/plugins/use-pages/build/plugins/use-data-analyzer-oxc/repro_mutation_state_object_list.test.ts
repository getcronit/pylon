import {describe, expect, it} from 'vitest'
import {createOxcAnalyzerCore} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'
import {schema} from './_schema'

/**
 * A mutation returning a nested plain-data DTO (ImportResult → ImportPlan → accountsToCreate:
 * [PlanAccount!]!) is awaited in a handler and stashed in React state; the render then reads the
 * nested OBJECT LIST `s.plan.accountsToCreate.map(a => a.number)`.
 *
 * The oxc analyzer has NO useState model, so `s` is opaque and the deep read records nothing —
 * the live trace can't reach it. The DEFAULT mutation-result selection must therefore fully
 * materialize the DTO, including nested object-LIST element subfields. Before the fix the
 * default recursed only ONE level (payload → each object's SCALARS), so `plan.accountsToCreate`
 * was dropped — which surfaced in lokalis as the runtime error
 *   Field "accountsToCreate" on type "ImportPlan" was read but is absent from the resolved data.
 */
const page = (body: string) =>
  `import { useMutation } from '@getcronit/pylon/pages'
   import { useState } from 'react'
   export default function P(props: any) {
     const [s, setS] = useState<any>(null)
     const [run] = useMutation("importPreview")
     const onGo = async () => { const r = await run({ x: "a" }); setS(r) }
     ${body}
     return null as any
   }`

const compile = (body: string) => {
  const c = createOxcAnalyzerCore({schema})
  c.transformPage('/app/P.tsx', page(body))
  return c.loadSidecar('\0pylon-docs:/app/P.tsx')!
}

describe('oxc analyzer · mutation result through React state · nested object list', () => {
  it('emits the nested object-LIST element subfields (via the default DTO expansion)', () => {
    const doc = compile(`
      const plan = s?.plan
      if (plan) plan.accountsToCreate.map((a: any) => [a.number, a.name, a.kind])
    `)
    expect(doc).toContain('importPreview')
    // The nested object list must be selected with its element subfields.
    const acct = doc.match(/accountsToCreate \{([^}]*)\}/)?.[1] ?? ''
    expect(acct).toContain('number')
    expect(acct).toContain('name')
    expect(acct).toContain('kind')
    // The scalar-list sibling was always fine — make sure it is still there.
    expect(doc).toContain('taxCodes')
  })
})
