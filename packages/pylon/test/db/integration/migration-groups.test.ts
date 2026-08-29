/**
 * Apps via the scoped factory `models.app(name)` + DERIVED migration groups,
 * against a real Postgres. Two apps — `accounts` (Account) and `billing`
 * (Invoice, FK→Account) — exercise:
 *   - `models.app(name)` tags each model's group in the registry,
 *   - `appGroups()` derives the groups and INFERS billing→accounts from the FK,
 *   - dependency-ordered apply, cross-group FK enforced, ledger namespacing.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  appGroups,
  type ModelConfig,
  connect,
  Database,
  db,
  deployGroups,
  generateGroup,
  migrateGroups,
  models,
  setDefaultDatabase,
  statusGroups,
  type MigrationGroup,
  type MigrationLoader,
  type Relation
} from '@/db/index'

class Account extends models.Model {
  static config = {table: 'app_account'} satisfies ModelConfig<Account>
  static objects = db.manager(Account)
  id = models.ID()
  email = models.Text()
}
new Pylon({name: 'accounts', db: {models: [Account]}})

class Invoice extends models.Model {
  static config = {table: 'app_invoice'} satisfies ModelConfig<Invoice>
  static objects = db.manager(Invoice)
  id = models.ID()
  amount = models.Text()
  accountId = models.ForeignKey(() => Account) // cross-app FK ⇒ billing deps accounts
  declare account: Relation<Account>
}
new Pylon({name: 'billing', db: {models: [Invoice]}})

const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('apps via models.app() + derived migration groups (Postgres)', () => {
  it('derives groups from the registry and INFERS deps from cross-app FKs', () => {
    const byName = Object.fromEntries(appGroups().map(g => [g.name, g]))
    expect(byName.accounts.models).toEqual([Account])
    expect(byName.billing.models).toEqual([Invoice])
    expect(byName.accounts.dependencies).toEqual([]) // no FK out
    expect(byName.billing.dependencies).toEqual(['accounts']) // inferred from FK
  })

  describe.skipIf(!runDb)('against the database', () => {
    let database: Database
    let accountsDir: string
    let billingDir: string
    let groups: MigrationGroup[]

    const cleanDb = async () => {
      await database.kysely.schema.dropTable('app_invoice').ifExists().cascade().execute()
      await database.kysely.schema.dropTable('app_account').ifExists().cascade().execute()
      for (const p of ['accounts:%', 'billing:%']) {
        await database.kysely
          .deleteFrom('_pylon_migrations' as never)
          .where('name' as never, 'like', p as never)
          .execute()
          .catch(() => {})
      }
    }

    beforeAll(async () => {
      database = connect({connectionString})
      accountsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-grp-accounts-'))
      billingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-grp-billing-'))
      // derive groups, then give each a (temp) migrations dir
      const dirs: Record<string, string> = {accounts: accountsDir, billing: billingDir}
      groups = appGroups().map(g => ({...g, dir: dirs[g.name]}))
      await cleanDb()
      const now = () => '20260101T000000' // identical file name in both → ledger collision test
      for (const g of groups) await generateGroup(g, 'init', load, {now})
    })

    afterAll(async () => {
      if (database) {
        await cleanDb()
        await database.destroy()
      }
      setDefaultDatabase(undefined)
      await fs.rm(accountsDir, {recursive: true, force: true})
      await fs.rm(billingDir, {recursive: true, force: true})
    })

    it('applies in dependency order even when passed out of order', async () => {
      const reversed = [...groups].reverse() // billing first
      expect(await migrateGroups(reversed, load, database)).toEqual([
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
      const rows = await database.kysely
        .selectFrom('_pylon_migrations' as never)
        .select('name' as never)
        .where('name' as never, 'like', '%:20260101T000000_init' as never)
        .execute()
      expect((rows as Array<{name: string}>).map(r => r.name).sort()).toEqual([
        'accounts:20260101T000000_init',
        'billing:20260101T000000_init'
      ])
    })

    it('status reports nothing pending; deploy is a no-op once applied', async () => {
      expect(await statusGroups(groups, load, database)).toEqual([
        {group: 'accounts', pendingChanges: 0, pending: [], unapplied: []},
        {group: 'billing', pendingChanges: 0, pending: [], unapplied: []}
      ])
      expect(await deployGroups(groups, load, database)).toEqual([
        {group: 'accounts', applied: []},
        {group: 'billing', applied: []}
      ])
    })
  })
})
