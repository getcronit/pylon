import {describe, expect, it} from 'vitest'
import {ModuleGraph} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/module-graph'
import {analyze} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/propagate'
import {schema} from './_schema'

const HOOK = `import { useData } from '@getcronit/pylon/pages'\n`

/** Two pages sharing an imported component, analyzed on ONE persistent graph so the
 *  component summary is computed for page A and reused (cache) for page B. */
describe('oxc analyzer · cross-call summary cache', () => {
  it('reuses a shared component summary across pages without corrupting results', () => {
    const graph = new ModuleGraph()
    const Row = `export function Row({ item }: any) { return <span>{item.name}{item.email}</span> }`
    const pageA =
      HOOK + `import { Row } from './Row'
      export default function A(){ const data = useData(); return <Row item={data.me} /> }`
    const pageB =
      HOOK + `import { Row } from './Row'
      export default function B(){ const data = useData(); return <Row item={data.user({ id: "1" })} /> }`

    const prime = (path: string, text: string) => graph.getFile(path, text)
    prime('/app/Row.tsx', Row)
    prime('/app/A.tsx', pageA)
    prime('/app/B.tsx', pageB)

    const selA = [...analyze([{path: '/app/A.tsx', text: pageA}], {schema, graph}).seedSelectors.values()][0]
    const selB = [...analyze([{path: '/app/B.tsx', text: pageB}], {schema, graph}).seedSelectors.values()][0]

    // Row's summary was cached after A; B reuses it, grafting onto its own seed.
    expect(selA).toEqual({me: {name: true, email: true}})
    expect(selB).toEqual({user: {__args: '{ id: "1" }', name: true, email: true}})

    // A re-analyzed after B still correct (cache hit, no state bleed).
    const selA2 = [...analyze([{path: '/app/A.tsx', text: pageA}], {schema, graph}).seedSelectors.values()][0]
    expect(selA2).toEqual({me: {name: true, email: true}})
  })
})
