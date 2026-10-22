import {describe, expect, it} from 'vitest'
import {ModuleGraph} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/module-graph'
import {analyze} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/propagate'
import {schema} from './_schema'

const HOOK = `import { useData } from '@getcronit/pylon/pages'\n`

/**
 * Regression: a seed-bearing component must NOT be served from the cross-call summary
 * cache. It used to cache ITSELF as "seed-free" on the 2nd fixpoint pass (the seed was
 * already in `seeds`, so the size delta read 0), then a later analyze() on the shared
 * graph — the paired server/client build, or a dev re-transform — hit that cache and
 * returned `seeds=0`, emitting a bare `useData()` (→ undefined data at runtime).
 */
describe('oxc analyzer · seed-bearing summaries are never cross-call cached', () => {
  const sel = (r: any) => [...r.seedSelectors.values()][0]

  it('the SAME seed component analyzed twice on one graph keeps its selection', () => {
    const graph = new ModuleGraph()
    const Shell =
      HOOK +
      `export function Shell(){ const data = useData(); return <span>{data.users.map((u) => u.email)}</span> }`
    graph.getFile('/app/Shell.tsx', Shell)

    const first = sel(analyze([{path: '/app/Shell.tsx', text: Shell}], {schema, graph}))
    const second = sel(analyze([{path: '/app/Shell.tsx', text: Shell}], {schema, graph}))

    expect(first).toMatchObject({users: {email: true}})
    expect(second).toEqual(first) // was {} (missing) before the fix
  })

  it('a seed component summarized as a dependency still seeds when analyzed as entry', () => {
    const graph = new ModuleGraph()
    const Shell =
      HOOK +
      `export function Shell(){ const data = useData(); return <span>{data.users.map((u) => u.name)}</span> }`
    const Page =
      HOOK +
      `import { Shell } from './Shell'
       export default function Page(){ const data = useData(); return <div>{data.me.id}<Shell /></div> }`
    graph.getFile('/app/Shell.tsx', Shell)
    graph.getFile('/app/Page.tsx', Page)

    // Page first (may pull Shell into the graph as a dependency), then Shell as entry.
    analyze([{path: '/app/Page.tsx', text: Page}], {schema, graph})
    const shellSel = sel(analyze([{path: '/app/Shell.tsx', text: Shell}], {schema, graph}))
    expect(shellSel).toMatchObject({users: {name: true}})
  })
})
