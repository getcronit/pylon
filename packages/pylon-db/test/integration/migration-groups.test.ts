/**
 * Migration groups (the data-layer primitive behind framework apps) against a
 * real Postgres. Two groups — `accounts` (Account) and `billing` (Invoice FK→
 * Account, depends on accounts) — exercise:
 *   - dependency-ordered apply (passed out of order → sorted),
 *   - cross-group FK enforced at the DB,
 *   - ledger namespacing: both groups deliberately use the SAME migration file
 *     name, so without per-group ledger prefixes the second apply would collide.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  Model,
  connect,
  Database,
  deployGroups,
  foreignKey,
  generateGroup,
  id,
  manager,
  migrateGroups,
  model,
  setDefaultDatabase,
  statusGroups,
  text,
  type MigrationGroup,
  type MigrationLoader,
  type Relation
} from '../../src/index'

@model({table: 'app_account'})
class Account extends Model {
  static objects = manager(Account)
  id = id()
  email = text()
}

@model({table: 'app_invoice'})
class Invoice extends Model {
  static objects = manager(Invoice)
  id = id()
  amount = text()
  accountId = foreignKey(() => Account)
  declare account: Relation<Account>
}

const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('migration groups (Postgres)', () => {
  let db: Database
  let accountsDir: string
  let billingDir: string
  let accounts: MigrationGroup
  let billing: MigrationGroup

  const cleanDb = async () => {
    await db.kysely.schema.dropTable('app_invoice').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('app_account').ifExists().cascade().execute()
    for (const p of ['accounts:%', 'billing:%']) {
      await db.kysely
        .deleteFrom('_pylon_migrations' as never)
        .where('name' as never, 'like', p as never)
        .execute()
        .catch(() => {})
    }
  }

  beforeAll(async () => {
    db = connect({connectionString})
    accountsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-grp-accounts-'))
    billingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-grp-billing-'))
    accounts = {name: 'accounts', models: [Account], dir: accountsDir}
    billing = {name: 'billing', models: [Invoice], dir: billingDir, dependencies: ['accounts']}
    await cleanDb()
    // Identical migration file name in BOTH groups — only ledger namespacing keeps
    // them from colliding on the `name` PK.
    const now = () => '20260101T000000'
    await generateGroup(accounts, 'init', load, {now})
    await generateGroup(billing, 'init', load, {now})
  })

  afterAll(async () => {
    if (db) {
      await cleanDb()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
    await fs.rm(accountsDir, {recursive: true, force: true})
    await fs.rm(billingDir, {recursive: true, force: true})
  })

  it('scopes generation per group (accounts→app_account, billing→app_invoice + cross-group FK)', async () => {
    expect(await fs.readdir(accountsDir)).toEqual(['20260101T000000_init.ts'])
    expect(await fs.readdir(billingDir)).toEqual(['20260101T000000_init.ts']) // same name, different dir

    const billSrc = await fs.readFile(path.join(billingDir, '20260101T000000_init.ts'), 'utf8')
    expect(billSrc).toContain('app_invoice')
    expect(billSrc).toContain('app_account') // FK references the other group's table
    expect(billSrc).not.toContain('"table": "app_account"') // but does NOT create it
  })

  it('migrateGroups applies in dependency order even when passed out of order', async () => {
    const results = await migrateGroups([billing, accounts], load, db) // wrong order in
    expect(results).toEqual([
      {group: 'accounts', applied: ['20260101T000000_init']},
      {group: 'billing', applied: ['20260101T000000_init']}
    ])
  })

  it('enforces the cross-group FK at the database', async () => {
    const acct = await Account.objects.create({email: 'a@b.co'})
    const inv = await Invoice.objects.create({amount: '10', accountId: acct.id})
    expect(inv.id).toBeTypeOf('number')
    await expect(
      Invoice.objects.create({amount: '0', accountId: 9_999_999})
    ).rejects.toThrow(/foreign key|violates|app_invoice_account_id/i)
  })

  it('namespaces the shared ledger (identical file names coexist)', async () => {
    const rows = await db.kysely
      .selectFrom('_pylon_migrations' as never)
      .select('name' as never)
      .where('name' as never, 'like', '%:20260101T000000_init' as never)
      .execute()
    const names = (rows as Array<{name: string}>).map(r => r.name).sort()
    expect(names).toEqual(['accounts:20260101T000000_init', 'billing:20260101T000000_init'])
  })

  it('status reports nothing pending; deploy is a no-op once applied', async () => {
    expect(await statusGroups([accounts, billing], load, db)).toEqual([
      {group: 'accounts', pendingChanges: 0, unapplied: []},
      {group: 'billing', pendingChanges: 0, unapplied: []}
    ])
    expect(await deployGroups([accounts, billing], load, db)).toEqual([
      {group: 'accounts', applied: []},
      {group: 'billing', applied: []}
    ])
  })
})
