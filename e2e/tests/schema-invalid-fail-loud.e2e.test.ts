/**
 * Hard invariant: Pylon must NEVER emit an invalid GraphQL schema. If type
 * introspection yields a schema that fails graphql's own validation, `pylon build`
 * must FAIL LOUDLY (non-zero exit + a clear message) and write NO schema.graphql —
 * never a broken schema that only crashes later at serve time (`assertValidSchema`).
 *
 * The fixture delegates a polymorphic remote type WITHOUT a return-type annotation,
 * so the inferred variant union is emitted as anonymous types that collide with the
 * declared classes (an interface member ends up missing a field). The build is pure
 * type introspection — no remote call — so no server is needed.
 *
 * Guards `assertSchemaIsValid` in the inject-code plugin.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, rmSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon-dev/dist/index.js')
const appDir = path.resolve(dir, '../fixtures/schema-invalid-app')
const schemaPath = path.join(appDir, '.pylon/schema.graphql')

describe('pylon build with a schema that fails validation', () => {
  afterAll(() => {
    rmSync(path.join(appDir, '.pylon'), {recursive: true, force: true})
  })

  it('exits NON-ZERO, reports the invalid schema, and writes no schema.graphql', () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    rmSync(path.join(appDir, '.pylon'), {recursive: true, force: true})

    const r = spawnSync('node', [cliBin, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`

    expect(r.status, `expected non-zero exit; output:\n${out}`).not.toBe(0)
    expect(out).toMatch(/invalid GraphQL schema/i)
    // The build must not have written a (broken) schema file.
    expect(existsSync(schemaPath), 'no schema.graphql should be written on failure').toBe(false)
  })
})
