import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {MigrationRunner, type Snapshot} from '../src/index'

function entity(name: string, cols: Array<{name: string; sqlType: any; nullable?: boolean; pk?: boolean}>): Snapshot {
  return {
    version: 1,
    entities: {
      [name]: {
        name,
        table: name.toLowerCase(),
        abstract: false,
        primaryKey: 'id',
        implements: [],
        fields: cols.map(c => ({
          name: c.name,
          type: {kind: 'scalar' as const, name: 'String', nullable: !!c.nullable},
          exposed: true,
          column: {
            name: c.name,
            sqlType: c.sqlType,
            primaryKey: !!c.pk,
            autoIncrement: !!c.pk,
            unique: false,
            nullable: !!c.nullable
          }
        }))
      }
    }
  }
}

const v1 = entity('User', [{name: 'id', sqlType: 'bigint', pk: true}])
const v2 = entity('User', [
  {name: 'id', sqlType: 'bigint', pk: true},
  {name: 'email', sqlType: 'text'}
])

describe('MigrationRunner — generate / status (file workflow, no DB)', () => {
  let dir: string
  let clock: number

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-'))
    clock = 0
  })
  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true})
  })

  const runnerFor = (current: () => Snapshot) =>
    new MigrationRunner({dir, current, now: () => `t${++clock}`})

  it('generates an initial migration and writes the baseline snapshot', async () => {
    const r = runnerFor(() => v1)
    const m = await r.generate('init')
    expect(m?.name).toBe('t1_init')
    expect(m?.up[0]).toMatch(/CREATE TABLE "user"/)

    // baseline snapshot.json now reflects v1
    const baseline = await r.loadBaseline()
    expect(Object.keys(baseline.entities)).toEqual(['User'])

    // the migration file is on disk
    const files = await r.list()
    expect(files.map(f => f.name)).toEqual(['t1_init'])
  })

  it('returns null when nothing changed', async () => {
    const r = runnerFor(() => v1)
    await r.generate('init')
    expect(await r.generate('noop')).toBeNull()
  })

  it('generates an incremental migration after a model change', async () => {
    let cur = v1
    const r = runnerFor(() => cur)
    await r.generate('init')

    cur = v2
    const m = await r.generate('add_email')
    expect(m?.name).toBe('t2_add_email')
    expect(m?.up).toEqual(['ALTER TABLE "user" ADD COLUMN "email" text NOT NULL'])
    expect(m?.down).toEqual(['ALTER TABLE "user" DROP COLUMN "email"'])

    const files = await r.list()
    expect(files.map(f => f.name)).toEqual(['t1_init', 't2_add_email'])
  })

  it('status reports uncaptured changes against the baseline', async () => {
    let cur = v1
    const r = runnerFor(() => cur)
    await r.generate('init')

    // before generating, status sees the pending delta
    cur = v2
    const before = await r.status()
    expect(before.pendingChanges.map(c => c.kind)).toEqual(['addColumn'])
    expect(before.unapplied).toEqual(['t1_init'])

    // after generating, the delta is captured (no pending changes)
    await r.generate('add_email')
    const after = await r.status()
    expect(after.pendingChanges).toEqual([])
    expect(after.unapplied).toEqual(['t1_init', 't2_add_email'])
  })
})
