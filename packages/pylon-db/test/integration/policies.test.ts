/**
 * Row-level authorization policies (`definePolicy`) against a real Postgres:
 * read scoping, write/delete authorization (→ ForbiddenError), create gating +
 * owner stamping, relation reads re-scoped by the target's read policy, the
 * `.unscoped()` bypass, and the `@model({secure})` deny-by-default flag.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  boolean,
  connect,
  Database,
  definePolicy,
  foreignKey,
  ForbiddenError,
  hasMany,
  id,
  int,
  manager,
  Model,
  model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'
import {runWithAppContext} from '../../src/app-context'

interface Principal {
  userId: number
  role?: 'USER' | 'ADMIN'
}

@model({table: 'pol_folder'})
class Folder extends Model {
  static objects = manager(Folder)
  id = id()
  name = text()
  notes = hasMany(() => Note, {foreignKey: 'folderId'})
}

@model({table: 'pol_note'})
class Note extends Model {
  static objects = manager(Note)
  id = id()
  title = text()
  ownerId = int()
  shared = boolean({default: false})
  folderId = foreignKey(() => Folder, {nullable: true})
  declare folder: Relation<Folder>
}

definePolicy(Note, {
  read: ({principal}) => {
    const p = principal as Principal | undefined
    return p?.role === 'ADMIN' ? {} : {OR: [{ownerId: p?.userId ?? -1}, {shared: true}]}
  },
  update: ({principal}) => ({ownerId: (principal as Principal | undefined)?.userId ?? -1}),
  delete: ({principal}) => ({ownerId: (principal as Principal | undefined)?.userId ?? -1}),
  create: ({principal}) => !!principal,
  onCreate: ({principal}, note) => {
    ;(note as Note).ownerId = (principal as Principal).userId
  }
})

@model({table: 'pol_vault', secure: true}) // deny-by-default; no policy defined
class Vault extends Model {
  static objects = manager(Vault)
  id = id()
  secret = text()
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const as = <T>(principal: Principal | undefined, fn: () => Promise<T>): Promise<T> =>
  runWithAppContext({principal}, fn)

describe.skipIf(!runDb)('row-level policies (Postgres)', () => {
  let db: Database
  const ids: Record<string, number> = {}

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['pol_note', 'pol_folder', 'pol_vault']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    const f = await runWithAppContext({}, () => Folder.objects.create({name: 'F'}))
    ids.folder = f.id
    // Seed as each user (create stamps ownerId from the principal).
    const a1 = await as({userId: 1}, () => Note.objects.create({title: 'a1', folderId: f.id}))
    await as({userId: 1}, () => Note.objects.create({title: 'a2', shared: true, folderId: f.id}))
    const b1 = await as({userId: 2}, () => Note.objects.create({title: 'b1', folderId: f.id}))
    ids.a1 = a1.id
    ids.b1 = b1.id
  })

  afterAll(async () => {
    if (db) {
      for (const t of ['pol_note', 'pol_folder', 'pol_vault']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const titles = (ns: Note[]) => ns.map(n => n.title).sort()

  it('READ is scoped per principal (own + shared; admin sees all)', async () => {
    expect(titles(await as({userId: 1}, () => Note.objects.all()))).toEqual(['a1', 'a2'])
    expect(titles(await as({userId: 2}, () => Note.objects.all()))).toEqual(['a2', 'b1'])
    expect(titles(await as({userId: 9, role: 'ADMIN'}, () => Note.objects.all()))).toEqual([
      'a1', 'a2', 'b1'
    ])
  })

  it('CREATE stamps owner from the principal and gates anonymity', async () => {
    const n = await as({userId: 7}, () => Note.objects.create({title: 'c1', ownerId: 999 as any}))
    expect(n.ownerId).toBe(7) // stamped, NOT the 999 from input
    await expect(as(undefined, () => Note.objects.create({title: 'x'}))).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('UPDATE a readable-but-unowned row → ForbiddenError', async () => {
    // user 2 can READ a2 (shared) but not UPDATE it (owned by user 1).
    await expect(
      as({userId: 2}, async () => {
        const a2 = await Note.objects.get({title: 'a2'})
        a2.title = 'hax'
        await a2.$save()
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    // owner can update
    const ok = await as({userId: 1}, async () => {
      const a2 = await Note.objects.get({title: 'a2'})
      a2.title = 'a2!'
      await a2.$save()
      return a2.title
    })
    expect(ok).toBe('a2!')
  })

  it('DELETE a row you do not own → ForbiddenError', async () => {
    await expect(
      as({userId: 2}, async () => {
        const a1 = await Note.objects.unscoped().get({id: ids.a1}) // load past read scope
        await a1.$delete()
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('relation reads are re-scoped by the target read policy (hasMany)', async () => {
    const forUser = (uid: number) =>
      as({userId: uid}, async () => {
        const f = await Folder.objects.get({id: ids.folder})
        return titles(await f.notes)
      })
    expect(await forUser(1)).toEqual(['a1', 'a2!']) // user1: own + shared
    expect(await forUser(2)).toEqual(['a2!', 'b1']) // user2: shared + own
    const admin = await as({userId: 9, role: 'ADMIN'}, async () => {
      const f = await Folder.objects.get({id: ids.folder})
      return titles(await f.notes)
    })
    expect(admin).toContain('a1')
    expect(admin).toContain('b1')
  })

  it('.unscoped() bypasses policy for system code', async () => {
    const all = await as({userId: 1}, () => Note.objects.unscoped().all())
    expect(all.length).toBeGreaterThanOrEqual(3) // sees others' rows
  })

  it('@model({secure}) denies every action with no matching rule', async () => {
    // CREATE denied — secure model with no `create` rule fails closed.
    await expect(as({userId: 1}, () => Vault.objects.create({secret: 's'}))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    // Seed a row out-of-band (raw insert, bypassing the ORM's create gate).
    await db.kysely.insertInto('pol_vault').values({secret: 's'} as any).execute()
    // READ denied → empty (deny compiles to WHERE false); .unscoped() sees it.
    expect(await as({userId: 1}, () => Vault.objects.all())).toEqual([])
    expect((await as({userId: 1}, () => Vault.objects.unscoped().all())).length).toBe(1)
  })
})
