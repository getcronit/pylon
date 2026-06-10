/**
 * Apps orchestration (the public `defineApp` / migrate / deploy API) against a
 * real Postgres. Two apps — `accounts` (Account) and `billing` (Invoice FK→
 * Account, depends on accounts) — exercise:
 *   - dependency-ordered apply (passed out of order → sorted),
 *   - cross-app FK enforced at the DB,
 *   - ledger namespacing: both apps deliberately use the SAME migration file name,
 *     so without per-app ledger prefixes the second apply would collide on the PK.
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
  defineApp,
  deployApps,
  foreignKey,
  generateApp,
  id,
  manager,
  migrateApps,
  model,
  setDefaultDatabase,
  statusApps,
  text,
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

describe.skipIf(!runDb)('apps orchestration (Postgres)', () => {
  let db: Database
  let accountsDir: string
  let billingDir: string
  let accounts: ReturnType<typeof defineApp>
  let billing: ReturnType<typeof defineApp>

  const cleanDb = async () => {
    await db.kysely.schema.dropTable('app_invoice').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('app_account').ifExists().cascade().execute()
    // only our namespaced rows; leave the shared ledger table for other tests
    await db.kysely
      .deleteFrom('_pylon_migrations' as never)
      .where('name' as never, 'like', 'accounts:%' as never)
      .execute()
      .catch(() => {})
    await db.kysely
      .deleteFrom('_pylon_migrations' as never)
      .where('name' as never, 'like', 'billing:%' as never)
      .execute()
      .catch(() => {})
  }

  beforeAll(async () => {
    db = connect({connectionString})
    accountsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-app-accounts-'))
    billingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-app-billing-'))
    accounts = defineApp({name: 'accounts', models: [Account], migrations: accountsDir})
    billing = defineApp({
      name: 'billing',
      models: [Invoice],
      migrations: billingDir,
      dependencies: ['accounts']
    })
    await cleanDb()
    // Identical migration file name in BOTH apps — only ledger namespacing keeps
    // them from colliding on the `name` PK.
    const now = () => '20260101T000000'
    await generateApp(accounts, 'init', load, {now})
    await generateApp(billing, 'init', load, {now})
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

  it('scopes generation per app (accounts→app_account, billing→app_invoice + cross-app FK)', async () => {
    const accFiles = await fs.readdir(accountsDir)
    const billFiles = await fs.readdir(billingDir)
    expect(accFiles).toEqual(['20260101T000000_init.ts'])
    expect(billFiles).toEqual(['20260101T000000_init.ts']) // same name, different dir

    const billSrc = await fs.readFile(path.join(billingDir, billFiles[0]), 'utf8')
    expect(billSrc).toContain('app_invoice')
    expect(billSrc).toContain('app_account') // FK references the other app's table
    expect(billSrc).not.toContain('"table": "app_account"') // but does NOT create it
  })

  it('migrateApps applies in dependency order even when passed out of order', async () => {
    const results = await migrateApps([billing, accounts], load, db) // wrong order in
    expect(results.map(r => r.app)).toEqual(['accounts', 'billing']) // sorted by deps
    expect(results).toEqual([
      {app: 'accounts', applied: ['20260101T000000_init']},
      {app: 'billing', applied: ['20260101T000000_init']}
    ])
  })

  it('enforces the cross-app FK at the database', async () => {
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
    const status = await statusApps([accounts, billing], load, db)
    expect(status).toEqual([
      {app: 'accounts', pendingChanges: 0, unapplied: []},
      {app: 'billing', pendingChanges: 0, unapplied: []}
    ])
    const deployed = await deployApps([accounts, billing], load, db)
    expect(deployed).toEqual([
      {app: 'accounts', applied: []},
      {app: 'billing', applied: []}
    ])
  })
})
