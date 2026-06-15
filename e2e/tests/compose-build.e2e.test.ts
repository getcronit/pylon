/**
 * Build-only e2e for `@getcronit/pylon-app`: runs the SHIPPED `pylon build` on a
 * fixture whose schema is `export const graphql = compose(appA, appB).graphql`,
 * then asserts on the generated `.pylon/schema.graphql`.
 *
 * This retires the one unknown flagged when `compose()` was built: that the real
 * compiler type-INTROSPECTS the deep-intersection type of the merged resolver
 * fragments (not just a runtime merge). It also proves compose's gate-wrapping
 * preserves field types — the `authorize`-gated `billing` ops must still appear
 * in the SDL with their real signatures.
 *
 * Requires the packages built (pretest builds pylon-auth/-db/-app/-dev too).
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, GraphQLObjectType, GraphQLSchema} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon-dev/dist/index.js')
const appDir = path.resolve(dir, '../fixtures/compose-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let sdl: string
let schema: GraphQLSchema | undefined

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(
      `pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`
    )
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
    sdl = await fs.readFile(schemaPath, 'utf8')
    schema = buildSchema(sdl)
  }
})

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('pylon build on compose().graphql', () => {
  it('builds successfully', () => {
    expect(buildResult.status, String(buildResult.stderr ?? buildResult.stdout ?? "")).toBe(0)
    expect(schema).toBeInstanceOf(GraphQLSchema)
  })

  it('introspects the merged Query/Mutation type from BOTH apps', () => {
    const query = schema!.getQueryType() as GraphQLObjectType
    const mutation = schema!.getMutationType() as GraphQLObjectType
    const qf = query.getFields()
    const mf = mutation.getFields()

    // catalog app
    expect(qf.product).toBeDefined()
    expect(qf.products).toBeDefined()
    expect(mf.addProduct).toBeDefined()
    // billing app (the gated one) — must still be present
    expect(qf.invoice).toBeDefined()
    expect(mf.issueInvoice).toBeDefined()
  })

  it('preserves field signatures through the gate wrapper', () => {
    const mutation = schema!.getMutationType() as GraphQLObjectType
    const addProduct = mutation.getFields().addProduct
    expect(addProduct.args.map(a => a.name).sort()).toEqual(['name', 'price'])
    // gated billing mutation keeps its arg too
    const issueInvoice = mutation.getFields().issueInvoice
    expect(issueInvoice.args.map(a => a.name)).toEqual(['total'])
    // the model type derived from the ORM is in the schema
    expect(schema!.getType('Product')).toBeDefined()
    expect(schema!.getType('Invoice')).toBeDefined()
  })
})
