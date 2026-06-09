import {makeMigration} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {Model, boolean, foreignKey, id, model, text, timestamp} from '../src/index'
import {planMigration, serializeSnapshot, snapshot, type Snapshot} from '../src/migrations'
import type {Relation} from '../src/relations'

@model()
class User extends Model {
  id = id()
  email = text({unique: true})
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
  $passwordHash = text({nullable: true})
}

@model()
class Post extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
}

describe('migrations — IR snapshot diff → SQL', () => {
  it('a snapshot is faithfully serializable (valid migration format)', () => {
    const s = snapshot()
    const round = JSON.parse(serializeSnapshot(s)) as Snapshot
    expect(round).toEqual(s)
    expect(Object.keys(round.entities).sort()).toEqual(['Post', 'User'])
  })

  it('initial migration (no prior snapshot) creates every table', () => {
    const m = planMigration(null)
    const created = m.changes
      .filter(c => c.kind === 'createTable')
      .map(c => (c as {entity: {name: string}}).entity.name)
      .sort()
    expect(created).toEqual(['Post', 'User'])

    const userDDL = m.up.find(s => s.includes('CREATE TABLE "user"'))!
    expect(userDDL).toMatch(/"email" text UNIQUE NOT NULL/)
    expect(userDDL).toMatch(/"password_hash" text/) // hidden column still migrated

    const postDDL = m.up.find(s => s.includes('CREATE TABLE "post"'))!
    // belongsTo → FK constraint, resolved through the IR entity lookup
    expect(postDDL).toMatch(/FOREIGN KEY \("author_id"\) REFERENCES "user" \("id"\)/)
  })

  it('no model changes → empty migration', () => {
    const s = snapshot()
    const m = planMigration(s, s)
    expect(m.up).toEqual([])
    expect(m.changes).toEqual([])
  })

  it('detects an added column against a prior snapshot', () => {
    const prev = snapshot()
    // Simulate evolving the model: drop the `email` column from the baseline,
    // so the current models look like they ADDED it.
    const baseline: Snapshot = JSON.parse(serializeSnapshot(prev))
    baseline.entities.User.fields = baseline.entities.User.fields.filter(
      f => f.name !== 'email'
    )
    const m = makeMigration(baseline.entities, prev.entities)
    expect(m.up).toEqual([
      'ALTER TABLE "user" ADD COLUMN "email" text UNIQUE NOT NULL'
    ])
    expect(m.down).toEqual(['ALTER TABLE "user" DROP COLUMN "email"'])
  })
})
