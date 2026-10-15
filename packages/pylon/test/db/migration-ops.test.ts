import {describe, expect, it, vi} from 'vitest'
import {
  addColumn,
  addForeignKey,
  addIndex,
  defineMigration,
  dropColumn,
  isReversible,
  migrationChecksum,
  renameColumn,
  run,
  runSql,
  schema,
  stateOnly
} from '@/db/migration-ops'
import type {MigrationContext, Operation} from '@/db/migration-ops'

/** A context that records exec'd SQL and exposes a fake db. */
function recordingCtx() {
  const sql: string[] = []
  const ctx: MigrationContext = {
    exec: async (s: string) => {
      sql.push(s)
    },
    db: {} as never,
    models: {get: () => { throw new Error('no historical models in this unit test') }}
  }
  return {ctx, sql}
}

const createWidget = {
  kind: 'createTable' as const,
  spec: {
    name: 'Widget',
    table: 'widget',
    columns: [
      {property: 'id', name: 'id', sqlType: 'bigint' as const, primaryKey: true, autoIncrement: true, unique: false, nullable: false}
    ]
  }
}

describe('schema() operation — always reversible, renders both directions', () => {
  it('up creates the table, down drops it', async () => {
    const op = schema([createWidget])
    expect(op.reversible).toBe(true)

    const a = recordingCtx()
    await op.up(a.ctx)
    expect(a.sql.join('\n')).toMatch(/CREATE TABLE "widget"/)

    const b = recordingCtx()
    await op.down(b.ctx)
    expect(b.sql.join('\n')).toMatch(/DROP TABLE "widget"/)
  })
})

describe('named operations — each wraps one change with built-in reverse', () => {
  const col = {
    name: 'age',
    sqlType: 'integer' as const,
    primaryKey: false,
    autoIncrement: false,
    unique: false,
    nullable: true
  }

  it('addColumn up adds, down drops', async () => {
    const op = addColumn('user', col)
    expect(op.reversible).toBe(true)
    const up = recordingCtx()
    await op.up(up.ctx)
    expect(up.sql).toEqual(['ALTER TABLE "user" ADD COLUMN "age" integer'])
    const down = recordingCtx()
    await op.down(down.ctx)
    expect(down.sql).toEqual(['ALTER TABLE "user" DROP COLUMN "age"'])
  })

  it('dropColumn down re-adds from the spec', async () => {
    const down = recordingCtx()
    await dropColumn('user', col).down(down.ctx)
    expect(down.sql).toEqual(['ALTER TABLE "user" ADD COLUMN "age" integer'])
  })

  it('addForeignKey up/down', async () => {
    const fk = {
      table: 'post',
      name: 'post_author_id_fkey',
      column: 'author_id',
      refTable: 'user',
      refColumn: 'id'
    }
    const up = recordingCtx()
    await addForeignKey(fk).up(up.ctx)
    expect(up.sql[0]).toMatch(/ADD CONSTRAINT "post_author_id_fkey" FOREIGN KEY/)
    const down = recordingCtx()
    await addForeignKey(fk).down(down.ctx)
    expect(down.sql).toEqual(['ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "post_author_id_fkey"'])
  })

  it('addIndex up creates, down drops', async () => {
    const ix = {name: 'user_age_idx', table: 'user', columns: ['age']}
    const up = recordingCtx()
    await addIndex(ix).up(up.ctx)
    expect(up.sql).toEqual(['CREATE INDEX "user_age_idx" ON "user" ("age")'])
    const down = recordingCtx()
    await addIndex(ix).down(down.ctx)
    expect(down.sql).toEqual(['DROP INDEX IF EXISTS "user_age_idx"'])
  })

  it('renameColumn is reversible (renames back)', async () => {
    const op = renameColumn('user', 'bio', 'about')
    const up = recordingCtx()
    await op.up(up.ctx)
    expect(up.sql).toEqual(['ALTER TABLE "user" RENAME COLUMN "bio" TO "about"'])
    const down = recordingCtx()
    await op.down(down.ctx)
    expect(down.sql).toEqual(['ALTER TABLE "user" RENAME COLUMN "about" TO "bio"'])
  })
})

describe('runSql() — reversible only with an explicit down', () => {
  it('with down: applies and reverses', async () => {
    const op = runSql('UPDATE a SET x=1', {down: 'UPDATE a SET x=0'})
    expect(op.reversible).toBe(true)
    const up = recordingCtx()
    await op.up(up.ctx)
    expect(up.sql).toEqual(['UPDATE a SET x=1'])
    const down = recordingCtx()
    await op.down(down.ctx)
    expect(down.sql).toEqual(['UPDATE a SET x=0'])
  })

  it('without down: irreversible — down throws', async () => {
    const op = runSql('UPDATE a SET x=1')
    expect(op.reversible).toBe(false)
    await expect(op.down(recordingCtx().ctx)).rejects.toThrow(/irreversible/i)
  })
})

describe('run() — data migration, reversible only with down', () => {
  it('with down: up and down call the handlers with the db', async () => {
    const up = vi.fn(async () => {})
    const down = vi.fn(async () => {})
    const op = run({up, down})
    expect(op.reversible).toBe(true)
    await op.up(recordingCtx().ctx)
    await op.down(recordingCtx().ctx)
    expect(up).toHaveBeenCalledOnce()
    expect(down).toHaveBeenCalledOnce()
  })

  it('without down: irreversible — down throws', async () => {
    const op = run({up: async () => {}})
    expect(op.reversible).toBe(false)
    await expect(op.down(recordingCtx().ctx)).rejects.toThrow(/irreversible/i)
  })
})

describe('migrationChecksum — content-derived, change-sensitive', () => {
  const mig = (sqlUp: string) =>
    defineMigration({operations: [schema([createWidget]), runSql(sqlUp, {down: 'noop'})]})

  it('is stable for identical operations', () => {
    expect(migrationChecksum(mig('UPDATE a SET x=1'))).toBe(
      migrationChecksum(mig('UPDATE a SET x=1'))
    )
  })

  it('changes when an operation changes', () => {
    expect(migrationChecksum(mig('UPDATE a SET x=1'))).not.toBe(
      migrationChecksum(mig('UPDATE a SET x=2'))
    )
  })
})

describe('migration reversibility = all operations reversible', () => {
  it('reversible when every op is', () => {
    const m = defineMigration({
      operations: [schema([createWidget]), runSql('x', {down: 'y'})]
    })
    expect(isReversible(m)).toBe(true)
  })

  it('irreversible if any op lacks a down', () => {
    const m = defineMigration({
      operations: [schema([createWidget]), runSql('x') as Operation]
    })
    expect(isReversible(m)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Regression: a change the renderer can't express must never become a migration
// that applies as a no-op yet still folds into the baseline as captured — that
// silently diverges the models from the database, with `status`/`check`/`deploy`
// all reporting "up to date" afterwards.
// ─────────────────────────────────────────────────────────────────────────────
describe('schema() refuses changes it cannot render', () => {
  const col = (name: string, extra: Record<string, unknown> = {}) => ({
    property: name,
    name,
    sqlType: 'text' as const,
    primaryKey: false,
    autoIncrement: false,
    unique: false,
    nullable: false,
    ...extra
  })

  it('throws on a primary-key change instead of emitting an empty operation', () => {
    expect(() =>
      schema([
        {
          kind: 'alterColumn',
          table: 'beta',
          before: col('code'),
          after: col('code', {primaryKey: true})
        }
      ])
    ).toThrow(/cannot be expressed as SQL[\s\S]*primary-key change on beta\.code/)
  })

  it('throws on adding/removing generated-ness', () => {
    expect(() =>
      schema([
        {
          kind: 'alterColumn',
          table: 'gamma',
          before: col('doc', {sqlType: 'tsvector', generatedAs: "to_tsvector('simple', code)"}),
          after: col('doc', {sqlType: 'tsvector'})
        }
      ])
    ).toThrow(/generated-column add\/remove on gamma\.doc/)
  })

  it('points at the runSql + stateOnly escape hatch', () => {
    expect(() =>
      schema([
        {kind: 'alterColumn', table: 'beta', before: col('code'), after: col('code', {primaryKey: true})}
      ])
    ).toThrow(/migrations\.runSql[\s\S]*migrations\.stateOnly/)
  })

  it('still accepts a fully renderable alter (nullable flip)', () => {
    const op = schema([
      {kind: 'alterColumn', table: 'beta', before: col('code'), after: col('code', {nullable: true})}
    ])
    expect(op.preview('up')).toEqual(['ALTER TABLE "beta" ALTER COLUMN "code" DROP NOT NULL'])
  })
})

describe('stateOnly()', () => {
  it('carries its changes for the fold but emits no SQL', async () => {
    const changes = [
      {
        kind: 'alterColumn' as const,
        table: 'beta',
        before: {property: 'code', name: 'code', sqlType: 'text' as const, primaryKey: false, autoIncrement: false, unique: false, nullable: false},
        after: {property: 'code', name: 'code', sqlType: 'text' as const, primaryKey: true, autoIncrement: false, unique: false, nullable: false}
      }
    ]
    const op = stateOnly(changes)
    expect(op.changes).toEqual(changes)
    expect(op.reversible).toBe(true)
    const {ctx, sql} = recordingCtx()
    await op.up(ctx)
    await op.down(ctx)
    expect(sql).toEqual([])
  })
})
