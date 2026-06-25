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
import {loadAppContribution} from '../src/project-bridge'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cwd = path.resolve(dir, 'fixtures/orm-build-app')
const entry = path.join(cwd, 'index.ts')

describe('Stage 2b — build merges the ORM contribution', () => {
  it('loadAppContribution executes models and returns the entity IR', async () => {
    const ir = await loadAppContribution(cwd, './index.ts')
    expect(ir).toBeDefined()
    expect(Object.keys(ir!.entities)).toContain('Product')
    const product = ir!.entities.Product
    expect(product.fields.find(f => f.name === 'id')?.type).toMatchObject({name: 'ID'})
    // $-prefixed column is present but hidden
    const note = product.fields.find(f => f.column?.name === 'internal_note')
    expect(note?.exposed).toBe(false)
  })

  it('the built schema reflects ORM intent (id→ID, $-column hidden)', async () => {
    const contributeIR = await loadAppContribution(cwd, './index.ts')
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

  it('visibility comes from the ORM exposed flag, not Pylon’s $-regex', async () => {
    // `internalCode` has a NORMAL name + {hidden:true}. Pure introspection has no
    // way to know it should be hidden, so it leaks it. The ORM contribution sets
    // exposed:false, so the merged build drops it. Proves entity visibility is
    // governed by the ORM's IR — and closes the old `{hidden:true}` no-op.
    const plain = new SchemaBuilder(entry).build().typeDefs
    expect(plain).toMatch(/internalCode/) // leaked by pure introspection

    const contributeIR = await loadAppContribution(cwd, './index.ts')
    const merged = new SchemaBuilder(entry).build({contributeIR}).typeDefs
    expect(merged).not.toMatch(/internalCode|internal_code/) // hidden by the ORM
  })
})
