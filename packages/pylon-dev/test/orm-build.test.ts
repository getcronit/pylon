/**
 * Stage 2b: `pylon build` obtains the ORM's entity IR by executing the models
 * (the shared bridge) and feeds it to `SchemaBuilder.build({contributeIR})`.
 * This test exercises that exact path against a real ORM-backed entry: load the
 * contribution, build, and assert the schema reflects ORM intent rather than
 * the type-checker's re-derivation.
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {SchemaBuilder} from '../src/builder/schema/builder'
import {loadOrmContribution} from '../src/orm-bridge'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cwd = path.resolve(dir, 'fixtures/orm-build-app')
const entry = path.join(cwd, 'index.ts')

describe('Stage 2b — build merges the ORM contribution', () => {
  it('loadOrmContribution executes models and returns the entity IR', async () => {
    const ir = await loadOrmContribution(cwd, './index.ts')
    expect(ir).toBeDefined()
    expect(Object.keys(ir!.entities)).toContain('Product')
    const product = ir!.entities.Product
    expect(product.fields.find(f => f.name === 'id')?.type).toMatchObject({name: 'ID'})
    // $-prefixed column is present but hidden
    const note = product.fields.find(f => f.column?.name === 'internal_note')
    expect(note?.exposed).toBe(false)
  })

  it('the built schema reflects ORM intent (id→ID, $-column hidden)', async () => {
    const contributeIR = await loadOrmContribution(cwd, './index.ts')
    const {typeDefs} = new SchemaBuilder(entry).build({contributeIR})
    expect(typeDefs).toMatch(/type Product/)
    expect(typeDefs).toMatch(/id: ID!/) // ORM intent — not the introspected Number
    expect(typeDefs).toMatch(/name: String!/)
    expect(typeDefs).not.toMatch(/internalNote|internal_note/)
  })

  it('without a contribution the build is unchanged (id introspected as Number)', () => {
    const {typeDefs} = new SchemaBuilder(entry).build()
    expect(typeDefs).toMatch(/type Product/)
    expect(typeDefs).toMatch(/id: Number!/)
  })
})
