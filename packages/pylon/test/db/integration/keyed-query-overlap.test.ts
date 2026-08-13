/**
 * Overlapping-paths correctness (the count-DISTINCT case). One task matches team T via
 * BOTH paths at once — directly (task.teamId = T) AND through its owner's membership
 * (owner ∈ T). A naive per-path sum would count it twice; the engine dedups by pk
 * (multi-path count gathers deduped id-sets — §7.4), so count() = 1, matching
 * .all().length. This pins the fix for the former UNION-DISTINCT gap.
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  batchKey,
  boolean,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  Model,
  type ModelConfig,
  type Relation,
  runAsSystem,
  syncSchema,
  text,
  type WhereInput
} from '../../src/index'

class OTeam extends Model {
  static config = {table: 'kqo_team'} satisfies ModelConfig<OTeam>
  static objects = manager(OTeam)
  id = id()
  name = text()
}
new Pylon({db: {models: [OTeam]}})

class OPerson extends Model {
  static config = {table: 'kqo_person'} satisfies ModelConfig<OPerson>
  static objects = manager(OPerson)
  id = id()
  memberships = hasMany(() => OMembership, {foreignKey: 'personId'})
}
new Pylon({db: {models: [OPerson]}})

class OMembership extends Model {
  static config = {table: 'kqo_membership'} satisfies ModelConfig<OMembership>
  static objects = manager(OMembership)
  id = id()
  personId = foreignKey(() => OPerson)
  teamId = foreignKey(() => OTeam)
  current = boolean()
}
new Pylon({db: {models: [OMembership]}})

class OTask extends Model {
  static config = {table: 'kqo_task'} satisfies ModelConfig<OTask>
  static objects = manager(OTask)
  id = id()
  status = text()
  teamId = foreignKey(() => OTeam, {nullable: true})
  ownerId = foreignKey(() => OPerson, {nullable: true})
  declare owner: Relation<OPerson>
}
new Pylon({db: {models: [OTask]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const markedWhere = (teamId: number): WhereInput<OTask> => ({
  status: 'OPEN',
  OR: [
    {teamId: batchKey(teamId)},
    {owner: {memberships: {some: {teamId: batchKey(teamId), current: true}}}}
  ]
})

describe.skipIf(!runDb)('keyed-query — overlapping paths (UNION-DISTINCT gap)', () => {
  let db: Database
  let team = 0

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['kqo_task', 'kqo_membership', 'kqo_person', 'kqo_team']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    await runAsSystem(async () => {
      const t = await OTeam.objects.create({name: 'T'})
      team = t.id
      const p = await OPerson.objects.create({})
      await OMembership.objects.create({personId: p.id, teamId: t.id, current: true})
      // ONE task that matches T via BOTH paths: on the team AND owned by a member.
      await OTask.objects.create({status: 'OPEN', teamId: t.id, ownerId: p.id})
    })
  })

  it('.all() is correct (dedups by pk) — one distinct task', async () => {
    await runAsSystem(async () => {
      const rows = await OTask.objects.filter(markedWhere(team)).all()
      expect(rows.length).toBe(1)
    })
  })

  it('count() dedups overlapping paths — one distinct match, not 2', async () => {
    await runAsSystem(async () => {
      const n = await OTask.objects.filter(markedWhere(team)).count()
      expect(n).toBe(1) // direct + through match the same task → counted ONCE
    })
  })

  it('count() agrees with .all().length under overlap', async () => {
    await runAsSystem(async () => {
      const [n, rows] = await Promise.all([
        OTask.objects.filter(markedWhere(team)).count(),
        OTask.objects.filter(markedWhere(team)).all()
      ])
      expect(n).toBe(rows.length)
    })
  })
})
