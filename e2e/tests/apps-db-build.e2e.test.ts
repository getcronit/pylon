/**
 * The new multi-app model: each "app" is a `new Pylon({graphql})` with its own
 * name-tagged DB models; the root `compose()`s them into ONE merged schema +
 * mounted routes. Build-only — proves the compiler introspects the composed
 * `default.graphql` AND merges every app's ORM models into the single schema
 * (shop_product + blog_post), with no defineApp/useApp/.resolvers.
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
const appDir = path.resolve(dir, '../fixtures/apps-db-app')
const pylonDir = path.join(appDir, '.pylon')

let build: ReturnType<typeof spawnSync>
let schema: GraphQLSchema | undefined

beforeAll(async () => {
  if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
  await fs.rm(pylonDir, {recursive: true, force: true})
  build = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  const schemaPath = path.join(pylonDir, 'schema.graphql')
  if (existsSync(schemaPath)) schema = buildSchema(await fs.readFile(schemaPath, 'utf8'))
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('multi-app: new Pylon({graphql}) + models, composed at the root', () => {
  it('builds', () => {
    expect(build.status, String(build.stderr ?? build.stdout ?? "")).toBe(0)
    expect(schema).toBeInstanceOf(GraphQLSchema)
  })

  it('merges both apps into one Query', () => {
    const q = (schema!.getQueryType() as GraphQLObjectType).getFields()
    expect(q.products).toBeDefined() // shop (gated, tenant-scoped)
    expect(q.posts).toBeDefined() // blog
    expect(q.post).toBeDefined()
  })

  it('merges both apps into one Mutation', () => {
    const m = (schema!.getMutationType() as GraphQLObjectType).getFields()
    expect(m.addProduct).toBeDefined() // shop
    expect(m.addPost).toBeDefined() // blog
  })

  it('merges each app ORM model into the schema (shop_product, blog_post types)', () => {
    const product = schema!.getType('Product') as GraphQLObjectType
    const post = schema!.getType('Post') as GraphQLObjectType
    expect(product).toBeInstanceOf(GraphQLObjectType)
    expect(post).toBeInstanceOf(GraphQLObjectType)
    // shop's Product is tenant-scoped → carries orgId; the gate is type-transparent.
    expect(Object.keys(product.getFields()).sort()).toEqual(['id', 'name', 'orgId', 'price'])
    expect(Object.keys(post.getFields()).sort()).toEqual(['body', 'id', 'title'])
  })
})
