/**
 * `pylon inspect` end-to-end: runs the shipped CLI and asserts the emitted AppModel
 * fuses the schema/entities (Tier 1) with the queues + authz-shape slices (Tier 2).
 */
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/inspect-app')

function run(...args: string[]) {
  return spawnSync('node', [cliBin, 'inspect', ...args], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
}

describe('pylon inspect', () => {
  if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)

  it('--json emits an AppModel: schema + queues + authz', () => {
    const r = run('--json')
    expect(r.status, r.stderr).toBe(0)
    const model = JSON.parse(r.stdout)

    expect(model.version).toBe(1)
    // Tier 1: schema + entities
    expect(model.schema.entities.Product).toBeDefined()
    expect(model.schema.operations.some((o: any) => o.name === 'products')).toBe(true)

    // Tier 2: authz-shape (from `static config = {secure: true}`)
    const product = model.authz.find((a: any) => a.model === 'Product')
    expect(product).toBeDefined()
    expect(product.secure).toBe(true)

    // Tier 2: queues (app-namespaced with a '.' separator — ':' is forbidden by
    // BullMQ/Redis as the key separator, with declared options)
    const reindex = model.queues.find((q: any) => q.name === 'shop.reindex')
    expect(reindex).toBeDefined()
    expect(reindex.attempts).toBe(3)
  })

  it('--sdl emits the GraphQL schema', () => {
    const r = run('--sdl')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('type Product')
    expect(r.stdout).toContain('type Query')
  })

  it('--ddl emits the persistence DDL', () => {
    const r = run('--ddl')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.toLowerCase()).toContain('create table')
  })

  it('is deterministic (byte-identical across runs)', () => {
    expect(run('--json').stdout).toBe(run('--json').stdout)
  })

  it('prunes the empty ORM base types (Model / IModel)', () => {
    const model = JSON.parse(run('--json').stdout)
    expect(model.schema.objects.Model).toBeUndefined()
    expect(model.schema.interfaces.IModel).toBeUndefined()
  })

  it('has a stable AppModel shape (format-drift guard)', () => {
    const model = JSON.parse(run('--json').stdout)
    expect(Object.keys(model).sort()).toEqual(['authz', 'queues', 'schema', 'version'])
    expect(Object.keys(model.schema).sort()).toEqual([
      'entities',
      'enums',
      'inputs',
      'interfaces',
      'objects',
      'operations',
      'scalars',
      'unions',
      'version'
    ])
  })
})
