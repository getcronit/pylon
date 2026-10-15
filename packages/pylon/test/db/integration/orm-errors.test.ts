/**
 * Generic ORM error mappings (no per-entity error plumbing needed):
 *  - a Postgres unique violation (23505) → a `'unique'` ValidationError on the
 *    offending column(s), so `mutation()` turns it into a field-level userError.
 *  - a `.get()` miss → a NotFoundError (code NOT_FOUND), not a bare Error.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  id,
  manager,
  Model,
  NotFoundError,
  setDefaultDatabase,
  syncSchema,
  text,
  ValidationError
} from '@/db/index'

class ErrUser extends Model {
  static config = {table: 'err_user', indexes: [{columns: ['orgId', 'username'], unique: true}]} satisfies ModelConfig<ErrUser>
  static objects = manager(ErrUser)
  id = id()
  email = text({unique: true})
  orgId = text()
  username = text()
}
new Pylon({db: {models: [ErrUser]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('ORM error mapping (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('err_user').ifExists().cascade().execute()
    await syncSchema()
    await ErrUser.objects.create({email: 'a@b.com', orgId: 'o1', username: 'ada'})
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('err_user').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('single-column unique violation → `unique` ValidationError on that field', async () => {
    let err: unknown
    try {
      await ErrUser.objects.create({email: 'a@b.com', orgId: 'o1', username: 'bob'})
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    const issues = (err as ValidationError).issues
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({path: 'email', code: 'unique'})
  })

  it('composite unique violation → `unique` issues on each offending property', async () => {
    let err: unknown
    try {
      // duplicate (orgId, username) pair
      await ErrUser.objects.create({email: 'c@d.com', orgId: 'o1', username: 'ada'})
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    const paths = (err as ValidationError).issues.map(i => i.path).sort()
    expect(paths).toEqual(['orgId', 'username'])
    expect((err as ValidationError).issues.every(i => i.code === 'unique')).toBe(true)
  })

  it('.get() miss → NotFoundError (code NOT_FOUND), not a bare Error', async () => {
    let err: unknown
    try {
      await ErrUser.objects.get({email: 'nobody@nowhere.com'})
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(NotFoundError)
    expect((err as NotFoundError).code).toBe('NOT_FOUND')
    expect((err as NotFoundError).statusCode).toBe(404)
    expect((err as NotFoundError).entity).toBe('err_user')
  })

  it('a successful .get() still returns the row', async () => {
    const u = await ErrUser.objects.get({email: 'a@b.com'})
    expect(u.username).toBe('ada')
  })
})
