/**
 * Stage 1 build-only e2e for the `Pylon` class: runs the SHIPPED `pylon build` on a
 * fixture whose schema is `export const graphql = new Pylon().compose(catalog,
 * billing).graphql`, then asserts on the generated `.pylon/schema.graphql`.
 *
 * Proves that `Pylon.compose()` is type-INTROSPECTED by the real compiler — the
 * merged schema is the deep intersection of each child Pylon's `.resolvers()`
 * fragment — so a per-app `new Pylon()` composes into ONE schema (no ORM, no
 * pylon-app; isolates the core class composition).
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, GraphQLObjectType, GraphQLSchema} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/pylon-compose-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let schema: GraphQLSchema | undefined

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})

  buildResult = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })

  const schemaPath = path.join(pylonDir, 'schema.graphql')
  if (existsSync(schemaPath)) {
    schema = buildSchema(await fs.readFile(schemaPath, 'utf8'))
  }
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('pylon build on Pylon.compose().graphql', () => {
  it('builds successfully', () => {
    expect(buildResult.status, String(buildResult.stderr ?? buildResult.stdout ?? "")).toBe(0)
    expect(schema).toBeInstanceOf(GraphQLSchema)
  })

  it('merges both child Pylons into one Query', () => {
    const query = schema!.getQueryType() as GraphQLObjectType
    const fields = query.getFields()
    // catalog
    expect(fields.product).toBeDefined()
    expect(fields.products).toBeDefined()
    // billing
    expect(fields.invoice).toBeDefined()
  })

  it('merges both child Pylons into one Mutation', () => {
    const mutation = schema!.getMutationType() as GraphQLObjectType
    const fields = mutation.getFields()
    expect(fields.addProduct).toBeDefined() // catalog
    expect(fields.issueInvoice).toBeDefined() // billing
  })

  it('introspects the field types from each fragment (deep intersection)', () => {
    const product = schema!.getType('Product') as GraphQLObjectType
    const invoice = schema!.getType('Invoice') as GraphQLObjectType
    expect(product).toBeInstanceOf(GraphQLObjectType)
    expect(invoice).toBeInstanceOf(GraphQLObjectType)
    expect(Object.keys(product.getFields()).sort()).toEqual(['id', 'name', 'price'])
    expect(Object.keys(invoice.getFields()).sort()).toEqual(['id', 'total'])
  })
})
