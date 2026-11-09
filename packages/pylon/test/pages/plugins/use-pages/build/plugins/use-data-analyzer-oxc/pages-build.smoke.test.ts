import {fileURLToPath} from 'url'
import * as path from 'path'
import {rolldown} from 'rolldown'
import {describe, expect, it} from 'vitest'
import {useDataOxcRolldown} from '@/pages/plugins/use-pages/build/plugins/use-data-analyzer-oxc/index'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = path.join(here, 'fixture')

/**
 * End-to-end smoke test: run the fixture app through a REAL rolldown build with the
 * oxc analyzer plugin, exercising the whole plugin surface — buildStart, transform
 * (analyze → lower → rewrite), and resolveId/load for the virtual sidecar — and
 * assert the emitted bundle carries the compiled document (incl. cross-file reads).
 */
async function build(analyzer = 'oxc') {
  const prev = process.env.PYLON_ANALYZER
  process.env.PYLON_ANALYZER = analyzer
  try {
    const bundle = await rolldown({
      input: path.join(fx, 'Page.tsx'),
      plugins: [useDataOxcRolldown({schemaPath: path.join(fx, 'schema.graphql'), scalarTypes: {}})],
      external: id => id.startsWith('@getcronit/pylon')
    })
    const {output} = await bundle.generate({format: 'esm'})
    await bundle.close()
    return output.map(o => (o.type === 'chunk' ? o.code : '')).join('\n')
  } finally {
    if (prev === undefined) delete process.env.PYLON_ANALYZER
    else process.env.PYLON_ANALYZER = prev
  }
}

describe('pages build · oxc analyzer smoke test (real rolldown build)', () => {
  it('rewrites useData and inlines a compiled document with cross-file reads', async () => {
    const code = await build()

    // the useData() call was rewritten to reference the compiled doc + inline thunk
    expect(code).toMatch(/useData\(__pylonDoc_Page_0,/)
    // the sidecar's compiled document is bundled in
    expect(code).toContain('__pylonDoc_Page_0 = doc')
    // direct read in the page
    expect(code).toContain('me { email')
    // cross-file reads folded from `Row(data.user({ id: '1' }))` in Row.tsx
    expect(code).toContain('user(id: $v0)')
    expect(code).toContain('avatarUrl')
    expect(code).toContain('name')
    // variables thunk kept at the call site (closes over local `id`/literal)
    expect(code).toMatch(/\(\) => \(\{\s*v0:/)
  })
})
