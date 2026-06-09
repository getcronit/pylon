import {describe, expect, it} from 'vitest'
import {applyChanges, makeMigration, renderChanges, tableSpecOf, type Entity} from '../src/index'

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

  it('adds/drops a unique constraint on an existing column (reversible)', () => {
    const before = field('email', col({name: 'email', sqlType: 'text', unique: false}))
    const after = field('email', col({name: 'email', sqlType: 'text', unique: true}))
    const m = makeMigration(entity('User', [idField, before]), entity('User', [idField, after]))
    expect(m.unsupported).toEqual([])
    expect(m.up).toEqual([
      'ALTER TABLE "user" ADD CONSTRAINT "user_email_key" UNIQUE ("email")'
    ])
    expect(m.down).toEqual([
      'ALTER TABLE "user" DROP CONSTRAINT "user_email_key"'
    ])
  })

  it('reports a primary-key change as unsupported (never silent)', () => {
    const before = field('code', col({name: 'code', sqlType: 'text', primaryKey: false}))
    const after = field('code', col({name: 'code', sqlType: 'text', primaryKey: true}))
    const m = makeMigration(entity('User', [before]), entity('User', [after]))
    expect(m.unsupported).toHaveLength(1)
    expect(m.unsupported[0]).toMatch(/primary-key change on user\.code/)
  })

  it('no changes → empty migration', () => {
    const same = entity('User', [idField])
    const m = makeMigration(same, structuredClone(same))
    expect(m.changes).toEqual([])
    expect(m.up).toEqual([])
    expect(m.down).toEqual([])
  })
})

describe('migration engine — foreign keys (self-contained, never inline)', () => {
  const user = (): Entity => ({
    name: 'User',
    table: 'user',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [idField]
  })

  /** Post(id, author_id) with an optional belongsTo(author → User). */
  const post = (opts: {withFk?: boolean; onDelete?: any} = {}): Entity => {
    const fields: Entity['fields'] = [
      idField,
      field('authorId', col({name: 'author_id', sqlType: 'bigint'}))
    ]
    if (opts.withFk !== false) {
      fields.push({
        name: 'author',
        type: {kind: 'ref', name: 'User', nullable: false},
        exposed: true,
        relation: {kind: 'belongsTo', target: 'User', fkField: 'authorId', onDelete: opts.onDelete}
      })
    }
    return {name: 'Post', table: 'post', abstract: false, primaryKey: 'id', implements: [], fields}
  }

  const ADD_FK =
    'ALTER TABLE "post" ADD CONSTRAINT "post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user" ("id")'
  const DROP_FK = 'ALTER TABLE "post" DROP CONSTRAINT "post_author_id_fkey"'

  it('a new table FK to an existing table resolves at diff time (no inline FK)', () => {
    const m = makeMigration({User: user()}, {User: user(), Post: post()})
    expect(m.changes.map(c => c.kind)).toEqual(['createTable', 'addForeignKey'])
    expect(m.up[0]).toMatch(/CREATE TABLE "post"/)
    expect(m.up[0]).not.toMatch(/FOREIGN KEY/) // never inline
    expect(m.up[1]).toBe(ADD_FK)
    // down drops the constraint before the table
    expect(m.down).toEqual([DROP_FK, 'DROP TABLE "post"'])
  })

  it('adds a foreign key to an existing table (column already present)', () => {
    const m = makeMigration(
      {User: user(), Post: post({withFk: false})},
      {User: user(), Post: post()}
    )
    expect(m.changes.map(c => c.kind)).toEqual(['addForeignKey'])
    expect(m.up).toEqual([ADD_FK])
    expect(m.down).toEqual([DROP_FK])
  })

  it('drops a foreign key when the relation is removed but the column kept', () => {
    const m = makeMigration(
      {User: user(), Post: post()},
      {User: user(), Post: post({withFk: false})}
    )
    expect(m.changes.map(c => c.kind)).toEqual(['dropForeignKey'])
    expect(m.up).toEqual([DROP_FK])
    expect(m.down).toEqual([ADD_FK])
  })

  it('an onDelete change re-creates the constraint (drop + add, same name)', () => {
    const m = makeMigration(
      {User: user(), Post: post()},
      {User: user(), Post: post({onDelete: 'cascade'})}
    )
    expect(m.changes.map(c => c.kind)).toEqual(['dropForeignKey', 'addForeignKey'])
    // up: drop the old constraint, re-add it with ON DELETE CASCADE
    expect(m.up).toEqual([DROP_FK, `${ADD_FK} ON DELETE CASCADE`])
    // down: drop the cascading constraint, restore the original (no ON DELETE)
    expect(m.down).toEqual([DROP_FK, ADD_FK])
  })

  it('dropping a relation together with its FK column emits no explicit DROP CONSTRAINT', () => {
    // Post loses both the `author` relation AND the `author_id` column; Postgres
    // DROP COLUMN cascades the constraint, so a separate DROP CONSTRAINT would fail.
    const postNoAuthorCol: Entity = {
      name: 'Post',
      table: 'post',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [idField]
    }
    const m = makeMigration({User: user(), Post: post()}, {User: user(), Post: postNoAuthorCol})
    expect(m.changes.map(c => c.kind)).toEqual(['dropColumn'])
    expect(m.up).toEqual(['ALTER TABLE "post" DROP COLUMN "author_id"'])
    expect(m.up).not.toContain(DROP_FK)
  })
})

describe('migration engine — secondary indexes', () => {
  const withIndexes = (indexes: any[]): Record<string, Entity> => ({
    User: {
      name: 'User',
      table: 'user',
      abstract: false,
      primaryKey: 'id',
      implements: [],
      fields: [idField, field('email', col({name: 'email', sqlType: 'text'}))],
      indexes
    }
  })
  const base = withIndexes([])
  const idx = {name: 'user_email_idx', table: 'user', columns: ['email']}

  it('adds an index when one appears (reversible)', () => {
    const m = makeMigration(base, withIndexes([idx]))
    expect(m.changes.map(c => c.kind)).toEqual(['addIndex'])
    expect(m.up).toEqual(['CREATE INDEX "user_email_idx" ON "user" ("email")'])
    expect(m.down).toEqual(['DROP INDEX "user_email_idx"'])
  })

  it('drops an index when it disappears (down re-creates it)', () => {
    const m = makeMigration(withIndexes([idx]), base)
    expect(m.changes.map(c => c.kind)).toEqual(['dropIndex'])
    expect(m.up).toEqual(['DROP INDEX "user_email_idx"'])
    expect(m.down).toEqual(['CREATE INDEX "user_email_idx" ON "user" ("email")'])
  })

  it('renders a composite UNIQUE index', () => {
    const m = makeMigration(
      base,
      withIndexes([{name: 'user_a_b_key', table: 'user', columns: ['id', 'email'], unique: true}])
    )
    expect(m.up).toEqual([
      'CREATE UNIQUE INDEX "user_a_b_key" ON "user" ("id", "email")'
    ])
  })

  it('a column drop cascades its index — no explicit DROP INDEX', () => {
    const m = makeMigration(withIndexes([idx]), {
      User: {...base.User, fields: [idField]} // email column gone
    })
    expect(m.changes.map(c => c.kind)).toEqual(['dropColumn'])
    expect(m.up).not.toContain('DROP INDEX "user_email_idx"')
  })
})

describe('applyChanges — fold changes into state (round-trips diffEntities)', () => {
  const userV1 = entity('User', [idField])
  const userV2 = entity('User', [idField, field('email', col({name: 'email', sqlType: 'text'}))])

  const specV1 = {User: tableSpecOf(userV1.User)}
  const specV2 = {User: tableSpecOf(userV2.User)}

  it('createTable adds the table; folding the diff reproduces the target', () => {
    const folded = applyChanges({}, makeMigration({}, userV1).changes)
    expect(Object.keys(folded)).toEqual(['User'])
    expect(folded.User.table).toBe('user')
  })

  it('addColumn / dropColumn / rename evolve the columns in place', () => {
    const afterAdd = applyChanges(specV1, makeMigration(userV1, userV2).changes)
    expect(afterAdd.User.columns.some(c => c.name === 'email')).toBe(true)

    const afterDrop = applyChanges(specV2, makeMigration(userV2, userV1).changes)
    expect(afterDrop.User.columns.some(c => c.name === 'email')).toBe(false)

    const renamed = applyChanges(specV2, [
      {kind: 'renameColumn', table: 'user', from: 'email', to: 'contact'}
    ])
    expect(renamed.User.columns.map(c => c.name).sort()).toEqual(['contact', 'id'])
  })

  it('dropTable removes the table', () => {
    expect(applyChanges(specV1, [{kind: 'dropTable', spec: tableSpecOf(userV1.User)}])).toEqual({})
  })
})

describe('migration engine — renameColumn (authoring-only, never inferred)', () => {
  it('the diff never produces a rename (it sees drop + add)', () => {
    const before = entity('User', [idField, field('bio', col({name: 'bio', sqlType: 'text'}))])
    const after = entity('User', [idField, field('about', col({name: 'about', sqlType: 'text'}))])
    const m = makeMigration(before, after)
    expect(m.changes.map(c => c.kind).sort()).toEqual(['addColumn', 'dropColumn'])
  })

  it('renderChanges turns an authored renameColumn into ALTER … RENAME (reversible)', () => {
    const {up, down} = renderChanges([{kind: 'renameColumn', table: 'user', from: 'bio', to: 'about'}])
    expect(up).toEqual(['ALTER TABLE "user" RENAME COLUMN "bio" TO "about"'])
    expect(down).toEqual(['ALTER TABLE "user" RENAME COLUMN "about" TO "bio"'])
  })
})
