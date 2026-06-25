/**
 * Build-pipeline INTEGRATION test: drives the `build()` function in-process
 * (Bundler + loadAppContribution executing the models + SchemaBuilder.build
 * ({contributeIR}) + the inject-code plugin writing `.pylon/`) against a real
 * ORM-backed entry, and asserts on the emitted `.pylon/schema.graphql`.
 *
 * Fast inner-loop check (no built dist, no subprocess). The TRUE end-to-end test
 * — running the shipped `pylon` CLI on a real project — lives in the root `e2e/`
 * workspace. The fixture's models extend `Model` (all members excluded), so this
 * also guards the empty-`interface` path that broke a real build.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {build} from '../src/builder'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixtureCwd = path.resolve(dir, 'fixtures/build-app')
const pylonDir = path.join(fixtureCwd, '.pylon')

let schema: string
let originalCwd: string

beforeAll(async () => {
  originalCwd = process.cwd()
  // build() reads process.cwd() for the entry, output and tsconfig paths.
  process.chdir(fixtureCwd)
  await fs.rm(pylonDir, {recursive: true, force: true})

  const ctx = await build({sfiFilePath: './src/index.ts', outputFilePath: './.pylon'})
  // `build()` returns the bundler controls; the caller drives the build. Run the
  // server build to emit `.pylon/{index.js,schema.graphql,resolvers.js}`.
  await ctx.buildServer()
  await ctx.dispose() // release the esbuild service

  schema = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')
}, 60_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
  if (originalCwd) process.chdir(originalCwd)
})

describe('pylon build (real pipeline) on an ORM-backed app', () => {
  it('writes the schema and resolver artifacts', async () => {
    const files = await fs.readdir(pylonDir)
    expect(files).toContain('schema.graphql')
    expect(files).toContain('resolvers.js')
    expect(files).toContain('index.js')
  })

  it('emits VALID GraphQL SDL (no empty interface)', () => {
    expect(() => parse(schema)).not.toThrow()
    expect(schema).not.toMatch(/interface IModel/) // empty → dropped
  })

  it('reflects ORM intent merged from the model registry', () => {
    // id is ID (not the introspected Number); FK scalar is Int
    expect(schema).toMatch(/type Product\b/)
    expect(schema).toMatch(/\bid: ID!/)
    expect(schema).toMatch(/price: Int!/)
    // relations: hasMany → list, belongsTo → ref
    expect(schema).toMatch(/products: \[Product!\]!/)
    expect(schema).toMatch(/category: Category!/)
  })

  it('hides $-prefixed columns from the generated schema', () => {
    expect(schema).not.toMatch(/secretCost|secret_cost/)
  })

  it('exposes the root operations', () => {
    expect(schema).toMatch(/type Query\b/)
    expect(schema).toMatch(/products: \[Product!\]!/)
  })
})
