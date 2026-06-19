import {makeMigration} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {Model, id, manyToMany, model, text} from '../src/index'
import {toIR} from '../src/ir'

// Regression: a PAGINATED many-to-many must still synthesize its join table in
// the migration IR. Paginated relations are otherwise filtered out (they surface
// as Relay `Connection` fields via the type-checker, so the ORM mustn't also emit
// a plain list field). But a paginated m2m's JOIN TABLE must still exist in the
// desired schema — otherwise `db diff` sees the live join table as orphaned and
// emits `dropTable`, destroying the association rows. The fix keeps the relation
// in the IR with `exposed:false` (in for migrations, out of the GraphQL API).
@model()
class Collection extends Model {
  id = id()
  name = text()
  articles = manyToMany(() => Article, {paginate: true})
}

@model()
class Article extends Model {
  id = id()
  title = text()
}

describe('paginated many-to-many join table', () => {
  const ir = toIR()

  it('keeps the paginated m2m relation in the IR, but exposed:false', () => {
    const rel = ir.entities.Collection.fields.find(
      f => f.relation?.kind === 'manyToMany'
    )
    expect(rel).toBeTruthy()
    expect(rel!.exposed).toBe(false) // out of GraphQL, present for migrations
  })

  it('synthesizes the join table in the initial migration', () => {
    const m = makeMigration({}, ir.entities)
    const created = m.changes
      .filter(c => c.kind === 'createTable')
      .map(c => (c as {spec: {name: string}}).spec.name)
    // join table name = sorted table names → article_collection
    expect(created).toContain('article_collection')
  })
})
