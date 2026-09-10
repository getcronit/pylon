/**
 * The child-process project loader (PROJECT_LOADER_DESIGN.md): `introspectViaRunner`
 * spawns a tsx child that loads the project's REAL modules and returns its entity IR.
 * (The legacy bundle loader this replaced was proven byte-identical before deletion.)
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {introspectViaRunner} from '@/cli/project-bridge'
import {inspectApp} from '@/cli/inspect'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cwd = path.resolve(dir, 'fixtures/orm-build-app')

describe('project runner — child-process loader', () => {
  it('introspectViaRunner returns the project entity IR (id→ID, hidden column exposed:false)', async () => {
    const ir = await introspectViaRunner(cwd, './index.ts')

    expect(ir).toBeDefined()
    const product = ir!.entities.Product
    expect(product).toBeDefined()
    expect(product.fields.find(f => f.name === 'id')?.type).toMatchObject({name: 'ID'})
    // ORM visibility flowed through the child: the $-hidden column is present, exposed:false
    expect(product.fields.find(f => f.column?.name === 'internal_note')?.exposed).toBe(false)
  }, 30000)

  it('inspectApp (runner-backed) assembles the AppModel', async () => {
    const model = await inspectApp(cwd, './index.ts')
    expect(Object.keys(model.schema.entities)).toContain('Product')
    // authz derived from the ORM registry via the child
    expect(model.authz.find(a => a.model === 'Product')).toMatchObject({table: 'product', secure: false})
    // the ORM visibility flag flowed through the child: hidden column present but exposed:false
    const note = model.schema.entities.Product.fields.find(f => f.column?.name === 'internal_note')
    expect(note?.exposed).toBe(false)
  }, 30000)
})
