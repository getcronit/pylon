/**
 * App-level default policy + `runAsSystem` bypass (Postgres). An app declared
 * `models.app(name, {secure, policy})` makes every model deny-by-default with a
 * single shared default rule; per-model `definePolicy` overrides the exceptions;
 * `runAsSystem` lifts tenant + policy for trusted code (seeding/crons/audit).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  connect,
  Database,
  db,
  ForbiddenError,
  models,
  runAsSystem,
  setDefaultDatabase,
  syncSchema
} from '@/db/index'
import {runWithAppContext} from '@/db/app-context'

interface Principal {
  userId: number
  role?: 'USER' | 'ADMIN'
}

// One default for the whole app: "must be an authenticated (org) member". In a
// real app `tenant` draws the org boundary; here we just exercise the default.
const orgMember = ({principal}: {principal: unknown}) => !!principal

// polacc_doc — inherits the app default (no per-model policy)
class Doc extends models.Model {
  static objects = db.manager(Doc)
  id = models.ID()
  title = models.Text()
}

// polacc_secret — overrides read to ADMIN-only
class Secret extends models.Model {
  static objects = db.manager(Secret)
  id = models.ID()
  value = models.Text()
}

// The app: names the models (→ polacc_*), deny-by-default (secure) + app-default policy.
// Registered BEFORE definePolicy, which needs the model finalized.
new Pylon({name: 'polacc', db: {models: [Doc, Secret], secure: true, policy: orgMember}})

db.definePolicy(Secret, {
  read: ({principal}) => ((principal as Principal | undefined)?.role === 'ADMIN' ? {} : false)
})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const as = <T>(p: Principal | undefined, fn: () => Promise<T>): Promise<T> =>
  runWithAppContext({principal: p}, fn)

describe.skipIf(!runDb)('app-level default policy + runAsSystem (Postgres)', () => {
  let database: Database
  beforeAll(async () => {
    database = connect({connectionString})
    for (const t of ['polacc_doc', 'polacc_secret']) {
      await database.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    // runAsSystem bypasses the create gate → seeds with no principal bound.
    await runAsSystem(async () => {
      await Doc.objects.create({title: 'd1'})
      await Doc.objects.create({title: 'd2'})
      await Secret.objects.create({value: 's1'})
    })
  })
  afterAll(async () => {
    if (database) {
      for (const t of ['polacc_doc', 'polacc_secret']) {
        await database.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await database.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('the app default governs models with no per-model rule (read)', async () => {
    // authenticated → allowed (orgMember read = true); unauthenticated → denied (empty)
    expect((await as({userId: 1}, () => Doc.objects.all())).length).toBe(2)
    expect(await as(undefined, () => Doc.objects.all())).toEqual([])
  })

  it('the app default gates create; no principal → Forbidden', async () => {
    const made = await as({userId: 5}, () => Doc.objects.create({title: 'd3'}))
    expect(made.title).toBe('d3')
    await expect(as(undefined, () => Doc.objects.create({title: 'x'}))).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('a per-model definePolicy overrides the app default', async () => {
    // Secret read is ADMIN-only — a plain member is denied even though the app
    // default would allow.
    expect(await as({userId: 1}, () => Secret.objects.all())).toEqual([])
    expect((await as({userId: 9, role: 'ADMIN'}, () => Secret.objects.all())).length).toBe(1)
  })

  it('runAsSystem bypasses tenant + policy for reads, writes, AND creates', async () => {
    // sees ADMIN-only secrets with no principal bound
    expect((await runAsSystem(() => Secret.objects.all())).length).toBe(1)
    // creates on a secure model with no principal (the gate is lifted)
    const sys = await runAsSystem(() => Doc.objects.create({title: 'sysdoc'}))
    expect(sys.title).toBe('sysdoc')
  })
})
