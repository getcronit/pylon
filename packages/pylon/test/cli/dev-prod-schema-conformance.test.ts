/**
 * Dev/prod schema CONFORMANCE guard.
 *
 * There are now two ways the GraphQL schema reaches a running server:
 *
 *   - PROD: `pylon build` → `buildServer()` → emits `.pylon/schema.graphql` (+ schema.mjs),
 *     which `server.mjs` imports and hands to `handler()`.
 *   - DEV:  `pylon dev` (direct execution) never emits that glue — it calls `ctx.compile()`
 *     IN-PROCESS and feeds the resulting `typeDefs` straight to `handler()`.
 *
 * Today both go through the same cached `getBuildDefs` (SchemaBuilder), so they are
 * byte-identical by construction. This test LOCKS that contract: if a future change makes
 * one path transform, cache, or re-derive the SDL differently from the other, dev and prod
 * would silently serve different schemas — and this fails loudly instead.
 *
 * Fast + in-process (no subprocess, no Vite). The full `pylon dev` watch loop is covered by
 * the root `e2e/` workspace (dev-pages-loop.e2e.test.ts).
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {build} from '@/cli/builder'

const dir = path.dirname(fileURLToPath(import.meta.url))
// ORM-backed fixture: exercises the FULL path (analyzer + authoritative ORM IR merge), so
// the conformance guard covers the schema shape that's hardest to reproduce identically.
const fixtureCwd = path.resolve(dir, 'fixtures/build-app')
const pylonDir = path.join(fixtureCwd, '.pylon')

let devSchema: string
let prodSchema: string
let originalCwd: string

beforeAll(async () => {
  originalCwd = process.cwd()
  process.chdir(fixtureCwd)
  await fs.rm(pylonDir, {recursive: true, force: true})

  const ctx = await build({
    sfiFilePath: './src/index.ts',
    outputFilePath: './.pylon',
    mode: 'build'
  })

  // DEV path: the in-process compile the direct-execution dev server feeds to handler().
  devSchema = ctx.compile().typeDefs

  // PROD path: buildServer emits the glue, incl. `.pylon/schema.graphql`, that server.mjs
  // reads at boot. Read it back from disk — the exact bytes prod serves.
  await ctx.buildServer()
  prodSchema = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')

  await ctx.dispose()
}, 60_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
  if (originalCwd) process.chdir(originalCwd)
})

describe('dev/prod schema conformance', () => {
  it('the dev in-process schema is byte-identical to the prod-emitted schema.graphql', () => {
    expect(devSchema).toBe(prodSchema)
  })

  it('both are non-empty, valid GraphQL SDL', () => {
    expect(devSchema.trim().length).toBeGreaterThan(0)
    expect(() => parse(devSchema)).not.toThrow()
    expect(() => parse(prodSchema)).not.toThrow()
    // Sanity: a real schema with the root type, not an empty stub.
    expect(devSchema).toMatch(/type Query\b/)
  })
})
