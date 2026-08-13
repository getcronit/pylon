import {describe, expect, it} from 'vitest'
import {
  applyChanges,
  diffSchema,
  makeMigration,
  physicalSchemaOf,
  renameCandidates,
  tableRenameCandidates,
  renderChanges,
  tableSpecOf,
  type Entity
} from '@/ir/index'

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
      'ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_email_key"'
    ])
  })

  it('renders an inline CHECK and diffs check add/drop on an existing column (reversible)', () => {
    const plain = field('role', col({name: 'role', sqlType: 'text'}))
    const checked = field('role', col({name: 'role', sqlType: 'text', check: `"role" IN ('a','b')`}))

    // new table → inline CHECK
    const created = makeMigration({}, entity('User', [idField, checked]))
    expect(created.up[0]).toMatch(/CHECK \("role" IN \('a','b'\)\)/)

    // adding a check to an existing column → ADD/DROP CONSTRAINT, reversible
    const m = makeMigration(entity('User', [idField, plain]), entity('User', [idField, checked]))
    expect(m.up).toEqual([
      `ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('a','b'))`
    ])
    expect(m.down).toEqual([`ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_role_check"`])
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
  const DROP_FK = 'ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "post_author_id_fkey"'

  it('physicalSchemaOf extracts columns + resolved FKs (the state currency)', () => {
    const schema = physicalSchemaOf({User: user(), Post: post()})
    expect(schema.Post.columns.map(c => c.name).sort()).toEqual(['author_id', 'id'])
    expect(schema.Post.foreignKeys).toEqual([
      {
        table: 'post',
        name: 'post_author_id_fkey',
        column: 'author_id',
        refTable: 'user',
        refColumn: 'id',
        onDelete: undefined
      }
    ])
    // a diff of identical physical schemas is empty (the no-drift invariant)
    expect(diffSchema(schema, physicalSchemaOf({User: user(), Post: post()}))).toEqual([])
  })

  it('per-app scoping: FK target resolves against the universe, not just the materialized set', () => {
    // App "blog" materializes only Post; its FK target User lives in app "auth".
    // Without a universe, the cross-app FK is dropped (target not in the map)…
    const scopedAlone = physicalSchemaOf({Post: post()})
    expect(scopedAlone.Post.foreignKeys).toEqual([])
    expect(scopedAlone.User).toBeUndefined() // User is NOT materialized as a table

    // …with the universe (all apps' entities) the FK resolves, but only Post is
    // materialized — exactly what a per-app migration needs.
    const scopedWithUniverse = physicalSchemaOf({Post: post()}, {User: user(), Post: post()})
    expect(Object.keys(scopedWithUniverse)).toEqual(['Post']) // no app_user table
    expect(scopedWithUniverse.Post.foreignKeys).toEqual([
      {
        table: 'post',
        name: 'post_author_id_fkey',
        column: 'author_id',
        refTable: 'user',
        refColumn: 'id',
        onDelete: undefined
      }
    ])
  })

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
    expect(m.down).toEqual(['DROP INDEX IF EXISTS "user_email_idx"'])
  })

  it('drops an index when it disappears (down re-creates it)', () => {
    const m = makeMigration(withIndexes([idx]), base)
    expect(m.changes.map(c => c.kind)).toEqual(['dropIndex'])
    expect(m.up).toEqual(['DROP INDEX IF EXISTS "user_email_idx"'])
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
    expect(m.up).not.toContain('DROP INDEX IF EXISTS "user_email_idx"')
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

  it('detects rename candidates and a hint collapses drop+add into renameColumn', () => {
    const before = physicalSchemaOf(entity('User', [idField, field('bio', col({name: 'bio', sqlType: 'text'}))]))
    const after = physicalSchemaOf(entity('User', [idField, field('about', col({name: 'about', sqlType: 'text'}))]))

    const plain = diffSchema(before, after)
    expect(plain.map(c => c.kind).sort()).toEqual(['addColumn', 'dropColumn'])
    expect(renameCandidates(plain)).toEqual([{table: 'user', from: 'bio', to: 'about'}])

    const renamed = diffSchema(before, after, {renames: [{table: 'user', from: 'bio', to: 'about'}]})
    expect(renamed.map(c => c.kind)).toEqual(['renameColumn'])
    expect(renderChanges(renamed).up).toEqual([
      'ALTER TABLE "user" RENAME COLUMN "bio" TO "about"'
    ])
  })
})

describe('migration engine — renameTable (authoring-only)', () => {
  const change = {
    kind: 'renameTable' as const,
    from: 'Attribute',
    to: 'ProductAttribute',
    fromTable: 'products_attribute',
    toTable: 'products_product_attribute'
  }

  it('renders ALTER TABLE … RENAME TO (reversible)', () => {
    const {up, down} = renderChanges([change])
    expect(up).toEqual(['ALTER TABLE "products_attribute" RENAME TO "products_product_attribute"'])
    expect(down).toEqual(['ALTER TABLE "products_product_attribute" RENAME TO "products_attribute"'])
  })

  it('renders RENAME CONSTRAINT (reversible), a no-op in the fold', () => {
    const rc = {kind: 'renameConstraint' as const, table: 'user', from: 'user_email_key', to: 'user_login_key'}
    const {up, down} = renderChanges([rc])
    expect(up).toEqual(['ALTER TABLE "user" RENAME CONSTRAINT "user_email_key" TO "user_login_key"'])
    expect(down).toEqual(['ALTER TABLE "user" RENAME CONSTRAINT "user_login_key" TO "user_email_key"'])
    // constraint names aren't modeled in PhysicalSchema → folding it changes nothing
    const before = {User: {name: 'User', table: 'user', columns: [], foreignKeys: [], indexes: []}} as any
    expect(applyChanges(before, [rc])).toEqual(before)
  })

  it('a renamed UNIQUE column emits a paired RENAME CONSTRAINT', () => {
    const uniqueCol = (name: string) => col({name, sqlType: 'text', unique: true})
    const before = entity('Widget', [idField, field('code', uniqueCol('code'))])
    const after = entity('Widget', [idField, field('sku', uniqueCol('sku'))])
    const changes = diffSchema(physicalSchemaOf(before), physicalSchemaOf(after), {
      renames: [{table: 'widget', from: 'code', to: 'sku'}]
    })
    expect(changes.map(c => c.kind)).toEqual(['renameColumn', 'renameConstraint'])
    expect(renderChanges(changes).up).toEqual([
      'ALTER TABLE "widget" RENAME COLUMN "code" TO "sku"',
      'ALTER TABLE "widget" RENAME CONSTRAINT "widget_code_key" TO "widget_sku_key"'
    ])
  })

  it('re-keys the snapshot by model name and updates the physical table', () => {
    const before = {
      Attribute: {name: 'Attribute', table: 'products_attribute', columns: [], foreignKeys: [], indexes: []}
    } as any
    const after = applyChanges(before, [change])
    expect(Object.keys(after)).toEqual(['ProductAttribute'])
    expect(after.ProductAttribute.name).toBe('ProductAttribute')
    expect(after.ProductAttribute.table).toBe('products_product_attribute')
  })
})

describe('migration engine — table rename detection + collapse', () => {
  const before = physicalSchemaOf(
    entity('Attribute', [idField, field('handle', col({name: 'handle', sqlType: 'text'}))])
  )
  const after = physicalSchemaOf(
    entity('ProductAttribute', [idField, field('handle', col({name: 'handle', sqlType: 'text'}))])
  )

  it('the plain diff sees drop + create (never infers a rename)', () => {
    expect(diffSchema(before, after).map(c => c.kind).sort()).toEqual(['createTable', 'dropTable'])
  })

  it('flags a drop+create with identical columns as a table-rename candidate', () => {
    expect(tableRenameCandidates(diffSchema(before, after))).toEqual([
      {from: 'Attribute', to: 'ProductAttribute'}
    ])
  })

  it('a tableRenames hint collapses drop+create into a single renameTable', () => {
    const changes = diffSchema(before, after, {tableRenames: [{from: 'Attribute', to: 'ProductAttribute'}]})
    expect(changes.map(c => c.kind)).toEqual(['renameTable'])
    expect(renderChanges(changes).up).toEqual([
      'ALTER TABLE "attribute" RENAME TO "productattribute"'
    ])
    expect(tableRenameCandidates(changes)).toEqual([]) // no leftover drop+create
  })
})

describe('many-to-many join tables', () => {
  const m2mField = (name: string, target: string, through?: string) => ({
    name,
    type: {
      kind: 'list' as const,
      of: {kind: 'ref' as const, name: target, nullable: false},
      nullable: false
    },
    exposed: true,
    relation: {kind: 'manyToMany' as const, target, through}
  })
  const ent = (name: string, fields: Entity['fields']): Entity => ({
    name,
    table: name.toLowerCase(),
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields
  })
  const post = () => ent('Post', [idField, m2mField('tags', 'Tag')])
  const tag = () => ent('Tag', [idField, m2mField('posts', 'Post')])

  it('synthesizes one shared join table from both relation sides', () => {
    const schema = physicalSchemaOf({Post: post(), Tag: tag()})
    const jt = schema.post_tag
    expect(jt).toBeDefined()
    expect(jt.columns.map(c => c.name)).toEqual(['post_id', 'tag_id'])
    expect(jt.columns.every(c => !c.nullable && c.sqlType === 'bigint')).toBe(true)
    expect(jt.foreignKeys?.map(f => f.refTable).sort()).toEqual(['post', 'tag'])
    expect(jt.foreignKeys?.every(f => f.onDelete === 'cascade')).toBe(true)
    expect(jt.indexes?.[0]).toMatchObject({
      columns: ['post_id', 'tag_id'],
      unique: true
    })
  })

  it('emits a CREATE TABLE for the join table in a migration', () => {
    const m = makeMigration({}, {Post: post(), Tag: tag()})
    expect(m.up.some(s => /CREATE TABLE "post_tag"/.test(s))).toBe(true)
    // synthesized exactly once even though both sides declare the relation
    expect(m.up.filter(s => /CREATE TABLE "post_tag"/.test(s))).toHaveLength(1)
  })

  it('honors an explicit `through` table name', () => {
    const schema = physicalSchemaOf({
      Post: ent('Post', [idField, m2mField('tags', 'Tag', 'tagging')]),
      Tag: ent('Tag', [idField, m2mField('posts', 'Post', 'tagging')])
    })
    expect(schema.tagging).toBeDefined()
    expect(schema.post_tag).toBeUndefined()
  })
})

describe('full-text search DDL (generated tsvector + GIN index)', () => {
  const ftsEntity = (): Entity => ({
    name: 'Doc',
    table: 'doc',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [
      idField,
      field('title', col({name: 'title', sqlType: 'text'})),
      {
        name: 'fts',
        type: {kind: 'scalar' as const, name: 'String', nullable: true},
        exposed: false,
        column: col({
          name: 'fts',
          sqlType: 'tsvector',
          nullable: true,
          generatedAs: "to_tsvector('english', coalesce(\"title\", ''))",
          requires: 'postgres'
        })
      }
    ],
    indexes: [{name: 'doc_fts_gin', table: 'doc', columns: ['fts'], method: 'gin'}]
  })

  it('emits a STORED generated column + a GIN index', () => {
    const m = makeMigration({}, {Doc: ftsEntity()})
    const up = m.up.join('\n')
    expect(up).toMatch(/"fts" tsvector GENERATED ALWAYS AS \(to_tsvector\('english'/)
    expect(up).toMatch(/STORED/)
    expect(up).toMatch(/CREATE INDEX "doc_fts_gin" ON "doc" USING gin \("fts"\)/)
  })

  it('round-trips with no spurious diff (generatedAs is compared)', () => {
    const schema = physicalSchemaOf({Doc: ftsEntity()})
    expect(diffSchema(schema, physicalSchemaOf({Doc: ftsEntity()}))).toEqual([])
  })

  it('re-points a generated-column expression via SET EXPRESSION (not DROP/ADD, so the GIN index survives)', () => {
    const {up} = renderChanges([
      {
        kind: 'alterColumn',
        table: 'doc',
        before: col({
          name: 'fts',
          sqlType: 'tsvector',
          nullable: true,
          generatedAs: "to_tsvector('english', coalesce(\"title\", ''))"
        }),
        after: col({
          name: 'fts',
          sqlType: 'tsvector',
          nullable: true,
          generatedAs: "to_tsvector('german', coalesce(\"title\", ''))"
        })
      }
    ])
    expect(up.join('\n')).toMatch(
      /ALTER TABLE "doc" ALTER COLUMN "fts" SET EXPRESSION AS \(to_tsvector\('german'/
    )
    expect(up.join('\n')).not.toMatch(/DROP COLUMN/)
  })
})

describe('operator-class indexes (pg_trgm substring search)', () => {
  const trgmEntity = (ops: string | undefined = 'gin_trgm_ops'): Entity => ({
    name: 'Item',
    table: 'item',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [idField, field('sku', col({name: 'sku', sqlType: 'text', nullable: true}))],
    indexes: [{name: 'item_sku_trgm', table: 'item', columns: ['sku'], method: 'gin', ...(ops ? {ops} : {})}]
  })

  it('renders the per-column operator class and ensures the pg_trgm extension', () => {
    const m = makeMigration({}, {Item: trgmEntity()})
    const up = m.up.join('\n')
    expect(up).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/)
    expect(up).toMatch(/CREATE INDEX "item_sku_trgm" ON "item" USING gin \("sku" gin_trgm_ops\)/)
  })

  it('ensures the extension BEFORE creating the index', () => {
    const migration = makeMigration({}, {Item: trgmEntity()})
    const ext = migration.up.findIndex(s => /CREATE EXTENSION IF NOT EXISTS pg_trgm/.test(s))
    const idx = migration.up.findIndex(s => /CREATE INDEX "item_sku_trgm"/.test(s))
    expect(ext).toBeGreaterThanOrEqual(0)
    expect(ext).toBeLessThan(idx)
  })

  it('round-trips with no spurious diff (ops is compared)', () => {
    const schema = physicalSchemaOf({Item: trgmEntity()})
    expect(diffSchema(schema, physicalSchemaOf({Item: trgmEntity()}))).toEqual([])
  })

  it('detects an operator-class change (drops + re-adds the index)', () => {
    const before = physicalSchemaOf({Item: trgmEntity('gin_trgm_ops')})
    const after = physicalSchemaOf({Item: trgmEntity('')}) // '' → no opclass (plain gin)
    const changes = diffSchema(before, after)
    expect(changes.map(c => c.kind).sort()).toEqual(['addIndex', 'dropIndex'])
  })
})

describe('pgvector extension (vector column)', () => {
  const vecEntity = (): Entity => ({
    name: 'Embedding',
    table: 'embedding',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [
      idField,
      field('objectRef', col({name: 'object_ref', sqlType: 'text'})),
      field('embedding', col({name: 'embedding', sqlType: 'vector', dim: 1024}))
    ]
  })

  it('ensures the extension BEFORE the CREATE TABLE that uses vector(N)', () => {
    // Unlike pg_trgm (needed AFTER the table, for an index), the `vector(N)` type
    // needs its extension to exist before the table references it.
    const m = makeMigration({}, {Embedding: vecEntity()})
    const ext = m.up.findIndex(s => /CREATE EXTENSION IF NOT EXISTS vector/.test(s))
    const create = m.up.findIndex(s => /CREATE TABLE "embedding"/.test(s))
    expect(ext).toBeGreaterThanOrEqual(0)
    expect(ext).toBeLessThan(create)
    expect(m.up.join('\n')).toMatch(/"embedding" vector\(1024\)/)
  })

  it('down drops the table but never the extension (others may depend on it)', () => {
    const m = makeMigration({}, {Embedding: vecEntity()})
    expect(m.down).toEqual(['DROP TABLE "embedding"'])
    expect(m.down.join('\n')).not.toMatch(/EXTENSION/)
  })

  it('adding a vector column ensures the extension before ALTER … ADD COLUMN', () => {
    const noVec = vecEntity()
    const before = {Embedding: {...noVec, fields: noVec.fields.filter(f => f.name !== 'embedding')}}
    const m = makeMigration(before, {Embedding: vecEntity()})
    expect(m.changes.map(c => c.kind)).toEqual(['addColumn'])
    const ext = m.up.findIndex(s => /CREATE EXTENSION IF NOT EXISTS vector/.test(s))
    const add = m.up.findIndex(s => /ADD COLUMN "embedding"/.test(s))
    expect(ext).toBeGreaterThanOrEqual(0)
    expect(ext).toBeLessThan(add)
  })

  it('emits no vector extension when no column is a vector', () => {
    const m = makeMigration({}, entity('User', [idField, field('email', col({name: 'email', sqlType: 'text'}))]))
    expect(m.up.join('\n')).not.toMatch(/EXTENSION IF NOT EXISTS vector/)
  })

  it('round-trips with no spurious diff', () => {
    const schema = physicalSchemaOf({Embedding: vecEntity()})
    expect(diffSchema(schema, physicalSchemaOf({Embedding: vecEntity()}))).toEqual([])
  })
})

describe('pgvector ANN index (hnsw + operator class + storage params)', () => {
  const annEntity = (ops = 'vector_cosine_ops', withP?: Record<string, number>): Entity => ({
    name: 'Embedding',
    table: 'embedding',
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [idField, field('embedding', col({name: 'embedding', sqlType: 'vector', dim: 1024}))],
    indexes: [
      {
        name: 'embedding_embedding_hnsw',
        table: 'embedding',
        columns: ['embedding'],
        method: 'hnsw',
        ops,
        ...(withP ? {with: withP} : {})
      }
    ]
  })

  it('renders USING hnsw, the per-column operator class, and the WITH clause', () => {
    const up = makeMigration({}, {Embedding: annEntity('vector_cosine_ops', {m: 16, ef_construction: 64})}).up.join('\n')
    expect(up).toMatch(
      /CREATE INDEX "embedding_embedding_hnsw" ON "embedding" USING hnsw \("embedding" vector_cosine_ops\) WITH \(m = 16, ef_construction = 64\)/
    )
  })

  it('omits the WITH clause when there are no storage params', () => {
    const up = makeMigration({}, {Embedding: annEntity('vector_cosine_ops')}).up.join('\n')
    expect(up).toMatch(/USING hnsw \("embedding" vector_cosine_ops\)/)
    expect(up).not.toMatch(/WITH \(/)
  })

  it('round-trips with no spurious diff (ops + with are compared)', () => {
    const a = physicalSchemaOf({Embedding: annEntity('vector_cosine_ops', {m: 16, ef_construction: 64})})
    const b = physicalSchemaOf({Embedding: annEntity('vector_cosine_ops', {m: 16, ef_construction: 64})})
    expect(diffSchema(a, b)).toEqual([])
  })

  it('a metric (operator-class) change drops + re-adds the index', () => {
    const before = physicalSchemaOf({Embedding: annEntity('vector_cosine_ops')})
    const after = physicalSchemaOf({Embedding: annEntity('vector_l2_ops')})
    expect(diffSchema(before, after).map(c => c.kind).sort()).toEqual(['addIndex', 'dropIndex'])
  })

  it('a storage-param (with) change drops + re-adds the index', () => {
    const before = physicalSchemaOf({Embedding: annEntity('vector_cosine_ops', {m: 16, ef_construction: 64})})
    const after = physicalSchemaOf({Embedding: annEntity('vector_cosine_ops', {m: 32, ef_construction: 64})})
    expect(diffSchema(before, after).map(c => c.kind).sort()).toEqual(['addIndex', 'dropIndex'])
  })

  it('rejects an unsafe storage-param name (DDL is inlined, not bound)', () => {
    const bad = annEntity('vector_cosine_ops', {['m); DROP TABLE x --']: 1})
    expect(() => makeMigration({}, {Embedding: bad})).toThrow(/storage-param name/)
  })
})
