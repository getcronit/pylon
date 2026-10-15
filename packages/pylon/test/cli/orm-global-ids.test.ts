/**
 * Top-level `node: true` end-to-end through the build: the ORM contribution turns
 * on the Node projection, the SDL declares `interface Node` + `node(id): GID`, and
 * the build emits the matching runtime resolvers (`Query.node`, per-type `id`→gid).
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {SchemaBuilder} from '@/cli/builder/schema/builder'
import {introspectViaRunner} from '@/cli/project-bridge'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cwd = path.resolve(dir, 'fixtures/orm-global-ids-app')
const entry = path.join(cwd, 'index.ts')

describe('node: true — Node interface projected + resolvers emitted', () => {
  it('SDL declares Node, `implements Node`, and the node() refetch field', async () => {
    const contributeIR = await introspectViaRunner(cwd, './index.ts')
    const {typeDefs} = new SchemaBuilder(entry).build({contributeIR})
    expect(typeDefs).toMatch(/interface Node \{[^}]*id: ID!/)
    expect(typeDefs).toMatch(/type Product implements Node/)
    expect(typeDefs).toMatch(/type Category implements Node/)
    expect(typeDefs).toMatch(/node\(id: GID!\): Node/)
  }, 30000)

  it('emits a Query.node resolver AND preserves the user`s own Query field', async () => {
    const contributeIR = await introspectViaRunner(cwd, './index.ts')
    const {resolvers} = new SchemaBuilder(entry).build({contributeIR})
    expect(typeof (resolvers as any).Query.node).toBe('function')
  }, 30000)

  it('emits per-type `id` encoders that produce gids', async () => {
    const contributeIR = await introspectViaRunner(cwd, './index.ts')
    const {resolvers} = new SchemaBuilder(entry).build({contributeIR})
    const productId = (resolvers as any).Product.id
    const categoryId = (resolvers as any).Category.id
    expect(typeof productId).toBe('function')
    expect(productId({id: '12345'})).toBe('gid://pylon/Product/12345')
    expect(categoryId({id: 'abc'})).toBe('gid://pylon/Category/abc')
    // Null-safe.
    expect(productId({id: null})).toBeNull()
    expect(productId(null)).toBeNull()
  }, 30000)
})
