import {describe, expect, it} from 'vitest'
import {makeMigration, type Entity} from '../src/index'

const col = (over: {name: string; sqlType: any} & Record<string, unknown>) => ({
  primaryKey: false,
  autoIncrement: false,
  unique: false,
  nullable: false,
  ...over
})

const field = (name: string, column: any) => ({
  name,
  type: {kind: 'scalar' as const, name: 'String', nullable: !!column.nullable},
  exposed: true,
  column
})

function entity(name: string, fields: Entity['fields']): Record<string, Entity> {
  return {
    [name]: {name, table: name.toLowerCase(), abstract: false, primaryKey: 'id', implements: [], fields}
  }
}

const idField = field('id', col({name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true}))

describe('migration engine — diff two IR snapshots → SQL', () => {
  it('creates a table when an entity appears', () => {
    const next = entity('User', [idField, field('email', col({name: 'email', sqlType: 'text', unique: true}))])
    const m = makeMigration({}, next)
    expect(m.changes.map(c => c.kind)).toEqual(['createTable'])
    expect(m.up[0]).toMatch(/CREATE TABLE "user"/)
    expect(m.up[0]).toMatch(/"email" text UNIQUE NOT NULL/)
    expect(m.down).toEqual(['DROP TABLE "user"'])
  })

  it('drops a table when an entity disappears', () => {
    const prev = entity('User', [idField])
    const m = makeMigration(prev, {})
    expect(m.changes.map(c => c.kind)).toEqual(['dropTable'])
    expect(m.up).toEqual(['DROP TABLE "user"'])
    expect(m.down[0]).toMatch(/CREATE TABLE "user"/) // down recreates it
  })

  it('adds a column', () => {
    const prev = entity('User', [idField])
    const next = entity('User', [idField, field('age', col({name: 'age', sqlType: 'integer', nullable: true}))])
    const m = makeMigration(prev, next)
    expect(m.up).toEqual(['ALTER TABLE "user" ADD COLUMN "age" integer'])
    expect(m.down).toEqual(['ALTER TABLE "user" DROP COLUMN "age"'])
  })

  it('drops a column (down re-adds with the original spec)', () => {
    const prev = entity('User', [idField, field('age', col({name: 'age', sqlType: 'integer', nullable: true}))])
    const next = entity('User', [idField])
    const m = makeMigration(prev, next)
    expect(m.up).toEqual(['ALTER TABLE "user" DROP COLUMN "age"'])
    expect(m.down).toEqual(['ALTER TABLE "user" ADD COLUMN "age" integer'])
  })

  it('alters type, nullability and default — and inverts them in down', () => {
    const before = field('bio', col({name: 'bio', sqlType: 'varchar', length: 100, nullable: false}))
    const after = field('bio', col({name: 'bio', sqlType: 'text', nullable: true, defaultSql: `''`}))
    const m = makeMigration(entity('User', [idField, before]), entity('User', [idField, after]))
    expect(m.up).toEqual([
      'ALTER TABLE "user" ALTER COLUMN "bio" TYPE text',
      'ALTER TABLE "user" ALTER COLUMN "bio" DROP NOT NULL',
      `ALTER TABLE "user" ALTER COLUMN "bio" SET DEFAULT ''`
    ])
    expect(m.down).toEqual([
      'ALTER TABLE "user" ALTER COLUMN "bio" TYPE varchar(100)',
      'ALTER TABLE "user" ALTER COLUMN "bio" SET NOT NULL',
      'ALTER TABLE "user" ALTER COLUMN "bio" DROP DEFAULT'
    ])
  })

  it('reports unique churn on an existing column as unsupported (never silent)', () => {
    const before = field('email', col({name: 'email', sqlType: 'text', unique: false}))
    const after = field('email', col({name: 'email', sqlType: 'text', unique: true}))
    const m = makeMigration(entity('User', [idField, before]), entity('User', [idField, after]))
    expect(m.unsupported).toHaveLength(1)
    expect(m.unsupported[0]).toMatch(/unique change on user\.email/)
  })

  it('no changes → empty migration', () => {
    const same = entity('User', [idField])
    const m = makeMigration(same, structuredClone(same))
    expect(m.changes).toEqual([])
    expect(m.up).toEqual([])
    expect(m.down).toEqual([])
  })
})
