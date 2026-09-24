/**
 * Keyed-query batching against a real Postgres. A "task" belongs to a team either
 * DIRECTLY (task.teamId) or VIA its owner's current membership (owner → memberships
 * → team). Both paths are exercised by count()/keyedQuery, and by the batchKey()
 * marker deriving them from a natural predicate. Asserts:
 *  - correctness vs a per-team manual count (incl. a person in two teams, own-only,
 *    zero),
 *  - actual batching (N teams in one microtask → a handful of queries, not N),
 *  - the marker path == the explicit paths,
 *  - the §10 contract: a marked-but-unbatchable predicate throws (never silent N+1),
 *  - marker-free counts are untouched.
 */
import pg from 'pg'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  batchKey,
  boolean,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  keyedQuery,
  manager,
  Model,
  type ModelConfig,
  type Relation,
  runAsSystem,
  syncSchema,
  text,
  type WhereInput
} from '@/db/index'

class Team extends Model {
  static config = {table: 'kq_team'} satisfies ModelConfig<Team>
  static objects = manager(Team)
  id = id()
  name = text()
}
new Pylon({db: {models: [Team]}})

class Person extends Model {
  static config = {table: 'kq_person'} satisfies ModelConfig<Person>
  static objects = manager(Person)
  id = id()
  name = text()
  memberships = hasMany(() => Membership, {foreignKey: 'personId'})
}
new Pylon({db: {models: [Person]}})

class Membership extends Model {
  static config = {table: 'kq_membership'} satisfies ModelConfig<Membership>
  static objects = manager(Membership)
  id = id()
  personId = foreignKey(() => Person)
  teamId = foreignKey(() => Team)
  current = boolean()
}
new Pylon({db: {models: [Membership]}})

class Task extends Model {
  static config = {table: 'kq_task'} satisfies ModelConfig<Task>
  static objects = manager(Task)
  id = id()
  status = text()
  teamId = foreignKey(() => Team, {nullable: true}) // direct-on-team tasks
  ownerId = foreignKey(() => Person, {nullable: true}) // person tasks
  declare owner: Relation<Person>
}
new Pylon({db: {models: [Task]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// The natural marked predicate: open tasks on a team (own) or on its current members.
const markedWhere = (teamId: number): WhereInput<Task> => ({
  status: 'OPEN',
  OR: [
    {teamId: batchKey(teamId)},
    {owner: {memberships: {some: {teamId: batchKey(teamId), current: true}}}}
  ]
})

// Query counter (patched before connect so the pool's clients are wrapped).
let queries = 0
const origQuery = (pg as any).Client.prototype.query
;(pg as any).Client.prototype.query = function (...a: any[]) {
  queries++
  return origQuery.apply(this, a)
}

describe.skipIf(!runDb)('keyed-query batching (Postgres)', () => {
  let db: Database
  const team: Record<string, number> = {}
  const fillers: number[] = [] // many extra teams (1 open task each) for the batch-size test

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['kq_task', 'kq_membership', 'kq_person', 'kq_team']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()

    await runAsSystem(async () => {
      const alpha = await Team.objects.create({name: 'Alpha'})
      const beta = await Team.objects.create({name: 'Beta'})
      const gamma = await Team.objects.create({name: 'Gamma'}) // zero tasks
      team.alpha = alpha.id
      team.beta = beta.id
      team.gamma = gamma.id

      // p1 ∈ Alpha & Beta (current both), p2 ∈ Alpha (current), p3 ∈ Beta (FORMER).
      const p1 = await Person.objects.create({name: 'p1'})
      const p2 = await Person.objects.create({name: 'p2'})
      const p3 = await Person.objects.create({name: 'p3'})
      await Membership.objects.create({personId: p1.id, teamId: alpha.id, current: true})
      await Membership.objects.create({personId: p1.id, teamId: beta.id, current: true})
      await Membership.objects.create({personId: p2.id, teamId: alpha.id, current: true})
      await Membership.objects.create({personId: p3.id, teamId: beta.id, current: false})

      // Direct-on-team: Alpha 1 open, Beta 1 open + 1 closed.
      await Task.objects.create({status: 'OPEN', teamId: alpha.id})
      await Task.objects.create({status: 'OPEN', teamId: beta.id})
      await Task.objects.create({status: 'CLOSED', teamId: beta.id})
      // Person tasks: p1 2 open (counts for BOTH Alpha & Beta), p2 1 open (Alpha),
      // p3 1 open (Beta membership is former → must NOT count).
      await Task.objects.create({status: 'OPEN', ownerId: p1.id})
      await Task.objects.create({status: 'OPEN', ownerId: p1.id})
      await Task.objects.create({status: 'OPEN', ownerId: p2.id})
      await Task.objects.create({status: 'OPEN', ownerId: p3.id})

      // A large batch set: 50 more teams, each with exactly 1 open direct task. The
      // keyed count over ALL teams must stay a small CONSTANT number of queries — the
      // proof that batching is O(1) in the number of keys, not O(N).
      for (let i = 0; i < 50; i++) {
        const t = await Team.objects.create({name: `Filler${i}`})
        fillers.push(t.id)
        await Task.objects.create({status: 'OPEN', teamId: t.id})
      }
    })
  })

  afterAll(async () => {
    await db?.destroy?.()
  })

  // Expected (by hand):
  //  Alpha = 1 own + p1(2) + p2(1) = 4 ;  Beta = 1 own + p1(2) = 3 (p3 former) ; Gamma = 0
  it('marker count is correct across all path shapes', async () => {
    await runAsSystem(async () => {
      const [a, b, g] = await Promise.all([
        Task.objects.filter(markedWhere(team.alpha)).count(),
        Task.objects.filter(markedWhere(team.beta)).count(),
        Task.objects.filter(markedWhere(team.gamma)).count()
      ])
      expect(a).toBe(4)
      expect(b).toBe(3)
      expect(g).toBe(0)
    })
  })

  it('coalesces a LARGE key set into a constant number of queries (O(1), not O(N))', async () => {
    await runAsSystem(async () => {
      const teams = [team.alpha, team.beta, team.gamma, ...fillers] // 53 teams
      expect(teams.length).toBeGreaterThanOrEqual(50)
      queries = 0
      const counts = await Promise.all(teams.map(t => Task.objects.filter(markedWhere(t)).count()))
      // Two paths → 1 direct grouped count + (1 membership fetch + 1 grouped count) = ~3,
      // INDEPENDENT of the 53 keys. Un-batched this would be ~2×53 ≈ 100+ queries.
      expect(queries).toBeLessThanOrEqual(4)
      // Correctness holds across the whole batch.
      expect(counts[0]).toBe(4) // alpha
      expect(counts[1]).toBe(3) // beta
      expect(counts[2]).toBe(0) // gamma
      expect(counts.slice(3).every(c => c === 1)).toBe(true) // every filler = 1
    })
  })

  it('the marker derives the same plan as explicit keyedQuery({paths})', async () => {
    await runAsSystem(async () => {
      const explicit = (teamId: number) =>
        keyedQuery(Task, {
          key: teamId,
          where: {status: 'OPEN'},
          paths: [
            {column: 'teamId'},
            {
              through: Membership,
              on: 'personId',
              to: 'ownerId',
              key: 'teamId',
              where: {current: true}
            }
          ]
        }).count()
      const [ma, ea] = await Promise.all([
        Task.objects.filter(markedWhere(team.alpha)).count(),
        explicit(team.alpha)
      ])
      expect(ma).toBe(ea)
      expect(ma).toBe(4)
    })
  })

  it('a marked-but-unbatchable predicate throws (never a silent N+1)', async () => {
    await runAsSystem(async () => {
      // key in a range comparator → not projectable
      await expect(
        Task.objects.filter({status: {contains: batchKey('x')} as any}).count()
      ).rejects.toThrow(/batchKey\(\)/)
    })
  })

  it('marker-free counts are unaffected', async () => {
    await runAsSystem(async () => {
      const open = await Task.objects.filter({status: 'OPEN'}).count()
      // 6 detailed (2 direct-open + p1(2) + p2(1) + p3(1)) + 1 per filler team.
      expect(open).toBe(6 + fillers.length)
    })
  })

  it('.all() returns the matched rows across both paths', async () => {
    await runAsSystem(async () => {
      const [a, b, g] = await Promise.all([
        Task.objects.filter(markedWhere(team.alpha)).all(),
        Task.objects.filter(markedWhere(team.beta)).all(),
        Task.objects.filter(markedWhere(team.gamma)).all()
      ])
      expect(a.length).toBe(4)
      expect(b.length).toBe(3)
      expect(g.length).toBe(0)
      expect(a.every(t => t.status === 'OPEN')).toBe(true)
    })
  })

  it('.exists() and .first() batch on the marker', async () => {
    await runAsSystem(async () => {
      const [ea, eg, fa, fg] = await Promise.all([
        Task.objects.filter(markedWhere(team.alpha)).exists(),
        Task.objects.filter(markedWhere(team.gamma)).exists(),
        Task.objects.filter(markedWhere(team.alpha)).first(),
        Task.objects.filter(markedWhere(team.gamma)).first()
      ])
      expect(ea).toBe(true)
      expect(eg).toBe(false)
      expect(fa).not.toBeNull()
      expect(fg).toBeNull()
    })
  })

  it('dev N+1 advisory warns on many same-shape queries in one request', async () => {
    await runAsSystem(async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // 13 same-shape counts (only the teamId param varies) → past the default
      // threshold (12). The general log-level detector catches this regardless of the
      // terminal (count/all/first), unlike the old count-only hint.
      const teams = [team.alpha, team.beta, team.gamma, ...fillers.slice(0, 10)]
      await Promise.all(
        teams.map(t => Task.objects.filter({teamId: t, status: 'CLOSED'}).count())
      )
      const msgs = warn.mock.calls.map(c => String(c[0]))
      warn.mockRestore()
      expect(msgs.some(m => m.includes('[pylon-db:n+1]'))).toBe(true)
    })
  })

  it('.all() coalesces a large key set into a constant query count', async () => {
    await runAsSystem(async () => {
      const teams = [team.alpha, team.beta, team.gamma, ...fillers]
      queries = 0
      const lists = await Promise.all(teams.map(t => Task.objects.filter(markedWhere(t)).all()))
      // rows path: 1 column groupedRows + (1 membership fetch + 1 via groupedRows) ≈ 3,
      // independent of the 53 keys.
      expect(queries).toBeLessThanOrEqual(4)
      expect(lists[0].length).toBe(4) // alpha
      expect(lists[2].length).toBe(0) // gamma
      expect(lists.slice(3).every(l => l.length === 1)).toBe(true) // fillers
    })
  })
})
