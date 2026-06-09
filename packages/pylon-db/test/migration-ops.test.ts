import {describe, expect, it, vi} from 'vitest'
import {defineMigration, isReversible, run, runSql, schema} from '../src/migration-ops'
import type {MigrationContext, Operation} from '../src/migration-ops'

/** A context that records exec'd SQL and exposes a fake db. */
function recordingCtx() {
  const sql: string[] = []
  const ctx: MigrationContext = {
    exec: async (s: string) => {
      sql.push(s)
    },
    db: {} as never
  }
  return {ctx, sql}
}

const createWidget = {
  kind: 'createTable' as const,
  entity: {
    name: 'Widget',
    table: 'widget',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [
      {
        name: 'id',
        type: {kind: 'scalar' as const, name: 'ID', nullable: false},
        exposed: true,
        column: {name: 'id', sqlType: 'bigint' as const, primaryKey: true, autoIncrement: true, unique: false, nullable: false}
      }
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
