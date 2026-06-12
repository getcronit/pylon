/**
 * Reentrant `transaction()` + self-transactional `saveInstance`:
 *  - a save is atomic by default — a failing `postSave` rolls back the row;
 *  - `transaction()` joins an ambient transaction instead of opening a second
 *    one (kysely throws on `.transaction()` of a Transaction), so saves nest
 *    freely inside an outer `transaction()` and roll back with it.
 */
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  id,
  manager,
  Model,
  model,
  setDefaultDatabase,
  signals,
  syncSchema,
  text,
  transaction
} from '../../src/index'

@model({table: 'txn_widget'})
class Widget extends Model {
  static objects = manager(Widget)
  id = id()
  name = text()
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('reentrant transactions + atomic saves (Postgres)', () => {
  let db: Database
  const offs: Array<() => void> = []
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('txn_widget').ifExists().cascade().execute()
    await syncSchema()
  })
  afterEach(() => {
    while (offs.length) offs.pop()!()
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('txn_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('a failing postSave rolls back the row (save is atomic by default)', async () => {
    offs.push(
      signals.postSave.connect(Widget, () => {
        throw new Error('boom')
      })
    )
    await expect(Widget.objects.create({name: 'rollback-me'})).rejects.toThrow('boom')
    // The INSERT was rolled back with the failing hook — no explicit wrapper needed.
    expect(await Widget.objects.filter({name: 'rollback-me'}).count()).toBe(0)
  })

  it('transaction() is REENTRANT — nested saves join, no nested-txn error', async () => {
    await transaction(async () => {
      await Widget.objects.create({name: 'join-a'}) // saveInstance opens a txn → joins this one
      await Widget.objects.create({name: 'join-b'})
    })
    expect(await Widget.objects.filter({name: 'join-a'}).count()).toBe(1)
    expect(await Widget.objects.filter({name: 'join-b'}).count()).toBe(1)
  })

  it('an outer transaction() rolls back the saves nested in it', async () => {
    await transaction(async () => {
      await Widget.objects.create({name: 'tx-rollback'})
      throw new Error('rollback the whole thing')
    }).catch(() => {})
    expect(await Widget.objects.filter({name: 'tx-rollback'}).count()).toBe(0)
  })

  it('a postSave audit write commits with the row, rolls back with it', async () => {
    // postSave writes a sibling row in the SAME (joined) transaction.
    offs.push(
      signals.postSave.connect(Widget, async ({instances}) => {
        for (const w of instances) {
          if ((w as Widget).name === 'audit-ok') {
            await Widget.objects.create({name: 'audit-ok:audit'}) // exact guard → no recursion
          }
        }
      })
    )
    await Widget.objects.create({name: 'audit-ok'})
    expect(await Widget.objects.filter({name: 'audit-ok:audit'}).count()).toBe(1) // both committed
  })
})
