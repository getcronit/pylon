import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {MigrationRunner, type MigrationLoader, type Snapshot} from '../src/index'

// The baseline is reconstructed by folding the migration history, so generate/
// status take a loader. vitest transpiles the generated .ts files on import.
const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

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

  const fileContents = (r: MigrationRunner, name: string) =>
    fs.readFile(path.join(dir, `${name}.ts`), 'utf8')

  it('generates an initial migration (TS file); no snapshot.json', async () => {
    const r = runnerFor(() => v1)
    const m = await r.generate('init', load)
    expect(m?.name).toBe('t1_init')
    expect(m?.changes.map(c => c.kind)).toEqual(['createTable'])

    // the migration file is a TS module authored against the public API, using
    // the named (Django-style) operations rather than one schema([...]) blob
    const src = await fileContents(r, 't1_init')
    expect(src).toContain("import {migrations} from '@getcronit/pylon-db'")
    expect(src).toContain('migrations.defineMigration(')
    expect(src).toContain('migrations.createTable(')

    // the baseline is the migration history — no snapshot.json on disk
    expect(await fs.readdir(dir)).toEqual(['t1_init.ts'])
    expect(await r.list()).toEqual(['t1_init'])
  })

  it('returns null when nothing changed (baseline reconstructed from ops)', async () => {
    const r = runnerFor(() => v1)
    await r.generate('init', load)
    expect(await r.generate('noop', load)).toBeNull()
  })

  it('generates an incremental migration after a model change', async () => {
    let cur = v1
    const r = runnerFor(() => cur)
    await r.generate('init', load)

    cur = v2
    const m = await r.generate('add_email', load)
    expect(m?.name).toBe('t2_add_email')
    expect(m?.changes.map(c => c.kind)).toEqual(['addColumn'])

    expect(await r.list()).toEqual(['t1_init', 't2_add_email'])
  })

  it('plan renders up/down SQL with no database', async () => {
    const r = runnerFor(() => v1)
    await r.generate('init', load)

    const up = await r.plan(load, 'up')
    expect(up.map(p => p.name)).toEqual(['t1_init'])
    expect(up[0].statements.join('\n')).toMatch(/CREATE TABLE "user"/)

    const down = await r.plan(load, 'down')
    expect(down[0].statements.join('\n')).toMatch(/DROP TABLE "user"/)
  })

  it('detects divergent heads and reconverges them with a merge migration (DAG)', async () => {
    const r = runnerFor(() => v1)
    const mig = (deps?: string[]) =>
      `import {migrations} from '@getcronit/pylon-db'\n` +
      `export default migrations.defineMigration({${deps ? `dependencies: ${JSON.stringify(deps)}, ` : ''}operations: []})\n`
    // root, then two branches off it (two heads)
    await fs.writeFile(path.join(dir, 't1_init.ts'), mig())
    await fs.writeFile(path.join(dir, 't2a.ts'), mig(['t1_init']))
    await fs.writeFile(path.join(dir, 't2b.ts'), mig(['t1_init']))

    expect((await r.heads(load)).sort()).toEqual(['t2a', 't2b'])

    const merged = await r.merge(load, 'merge')
    expect(merged?.heads.sort()).toEqual(['t2a', 't2b'])
    expect(await r.heads(load)).toEqual([merged!.name]) // single head again

    // topological order: root first, both branches before the merge node
    const order = (await r.plan(load)).map(p => p.name)
    expect(order[0]).toBe('t1_init')
    expect(order[order.length - 1]).toBe(merged!.name)
    expect(order).toContain('t2a')
    expect(order).toContain('t2b')
  })

  it('squash collapses the schema history into one migration', async () => {
    let cur = v1
    const r = runnerFor(() => cur)
    await r.generate('init', load)
    cur = v2
    await r.generate('add_email', load)
    expect(await r.list()).toEqual(['t1_init', 't2_add_email'])

    const res = await r.squash(load, 'squash') // no DB
    expect(res?.replaced).toEqual(['t1_init', 't2_add_email'])
    // originals removed, a single squashed migration remains
    expect(await r.list()).toEqual([res!.name])
    const src = await fileContents(r, res!.name)
    expect(src).toContain('migrations.createTable(')
    expect(src).toMatch(/"name":\s*"email"/) // the net schema includes the added column
  })

  it('status reports uncaptured changes against the reconstructed baseline', async () => {
    let cur = v1
    const r = runnerFor(() => cur)
    await r.generate('init', load)

    // before generating, status sees the pending delta
    cur = v2
    const before = await r.status(load)
    expect(before.pendingChanges.map(c => c.kind)).toEqual(['addColumn'])
    expect(before.unapplied).toEqual(['t1_init'])

    // after generating, the delta is captured (no pending changes)
    await r.generate('add_email', load)
    const after = await r.status(load)
    expect(after.pendingChanges).toEqual([])
    expect(after.unapplied).toEqual(['t1_init', 't2_add_email'])
  })
})
