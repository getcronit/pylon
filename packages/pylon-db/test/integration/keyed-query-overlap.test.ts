/**
 * Demonstrates the UNION-DISTINCT gap. The engine's count() sums per-path grouped
 * counts, which is correct only for DISJOINT paths. Here one task matches team T via
 * BOTH paths at once — directly (task.teamId = T) AND through its owner's membership
 * (owner ∈ T). The direct path counts it once, the through path counts it again →
 * sum = 2, but there is only ONE distinct open task for T.
 *
 * `.all()` dedups by pk, so it correctly returns 1 — only `.count()` (and sum) is wrong.
 * The `it()` asserting the correct count(=1) FAILS today; it'll pass once count uses
 * `count(DISTINCT id)` over the UNION.
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

  it('count() OVER-COUNTS overlapping paths — currently returns 2, not 1', async () => {
    await runAsSystem(async () => {
      // Documents the current (wrong) behaviour: direct(1) + through(1) summed.
      const n = await OTask.objects.filter(markedWhere(team)).count()
      expect(n).toBe(2)
    })
  })

  // KNOWN GAP: count() should equal the distinct match (1), but disjoint-sum returns 2.
  // `it.fails` = expected-to-fail; it will start FAILING (i.e. flag) the day count()
  // uses `count(DISTINCT id)` over the UNION — the cue to convert this to a normal it().
  it.fails('count() SHOULD equal the distinct match (1) — pending UNION-DISTINCT', async () => {
    await runAsSystem(async () => {
      const n = await OTask.objects.filter(markedWhere(team)).count()
      expect(n).toBe(1)
    })
  })
})
