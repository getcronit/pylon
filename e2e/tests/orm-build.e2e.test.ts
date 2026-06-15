/**
 * TRUE end-to-end: runs the SHIPPED `pylon` CLI binary (a subprocess, against
 * the built dist) on a real ORM-backed Pylon project, then asserts on the
 * `.pylon/schema.graphql` it writes. Unlike the in-package integration test
 * (which calls `build()` in-process), this exercises the real binary, real
 * module resolution, and the full bundler — the consumer's actual experience.
 *
 * Assertions parse the SDL into a real `GraphQLSchema` (via `buildSchema`) and
 * inspect types/fields — `buildSchema` itself validates the document, so an
 * invalid schema (e.g. an empty interface) fails loudly rather than slipping
 * past a regex.
 *
 * Requires the packages to be built (the `pretest` script does this). The test
 * fails fast with guidance if the CLI binary is missing.
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
const appDir = path.resolve(dir, '../fixtures/orm-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let sdl: string
let schema: GraphQLSchema | undefined
let buildSchemaError: unknown

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(
      `pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\` ` +
        `(its pretest builds the packages), or build pylon-dev first.`
    )
  }
  await fs.rm(pylonDir, {recursive: true, force: true})

  // Run the actual shipped CLI exactly as a user would: `pylon build`.
  buildResult = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })

  if (buildResult.status === 0) {
    sdl = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')
    try {
      // buildSchema validates the document — invalid SDL throws here.
      schema = buildSchema(sdl)
    } catch (e) {
      buildSchemaError = e
    }
  }
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

/** Stringified GraphQL type of `Type.field` (e.g. "ID!", "[Product!]!"). */
function fieldType(typeName: string, fieldName: string): string {
  const t = schema!.getType(typeName)
  expect(t, `type ${typeName}`).toBeInstanceOf(GraphQLObjectType)
  const field = (t as GraphQLObjectType).getFields()[fieldName]
  expect(field, `${typeName}.${fieldName}`).toBeDefined()
  return String(field.type)
}

describe('pylon build (shipped CLI) on a real ORM project', () => {
  it('exits successfully', () => {
    expect(buildResult.status, String(buildResult.stderr ?? buildResult.stdout ?? "")).toBe(0)
  })

  it('writes the build artifacts', async () => {
    const files = await fs.readdir(pylonDir)
    expect(files).toContain('schema.graphql')
    expect(files).toContain('resolvers.js')
    expect(files).toContain('index.js')
  })

  it('emits a VALID executable schema (no empty interface)', () => {
    expect(buildSchemaError, String(buildSchemaError)).toBeUndefined()
    expect(schema).toBeInstanceOf(GraphQLSchema)
    expect(schema!.getType('IModel')).toBeUndefined() // empty interface dropped
  })

  it('reflects ORM intent in the parsed schema', () => {
    // id → ID (not the introspected Number); FK scalar → Int
    expect(fieldType('Product', 'id')).toBe('ID!')
    expect(fieldType('Product', 'price')).toBe('Int!')
    expect(fieldType('Product', 'categoryId')).toBe('Int!')
    // relations: hasMany → list, belongsTo → ref
    expect(fieldType('Category', 'products')).toBe('[Product!]!')
    expect(fieldType('Product', 'category')).toBe('Category!')
  })

  it('hides $-prefixed columns', () => {
    const product = schema!.getType('Product') as GraphQLObjectType
    expect(Object.keys(product.getFields())).not.toContain('secretCost')
  })

  it('exposes the root operations', () => {
    expect(fieldType('Query', 'products')).toBe('[Product!]!')
    expect(fieldType('Query', 'product')).toBe('Product!')
  })
})
