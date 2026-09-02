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
  generateGroup,
  getModelDefinitionOrThrow,
  migrateGroups,
  MigrationRunner,
  models,
  orderGroups,
  renameGroupApp,
  squashGroups,
  setDefaultDatabase,
  statusGroups,
  toIR,
  type MigrationGroup,
  type MigrationLoader,
  type Relation,
  type Snapshot
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

// A MUTUAL cross-app FK (the tickets↔tasks shape from the cycle-tolerance fix):
// `tickets.Ticket.relatedTaskId → tasks.Task` AND `tasks.Task.relatedTicketId →
// tickets.Ticket`. Each side FKs the other's table ⇒ the two GROUPS depend on each
// other (a cycle in the group graph). Both FK columns are nullable so a row on
// either side can exist before its counterpart.
class Ticket extends models.Model {
  static config = {table: 'app_ticket'} satisfies ModelConfig<Ticket>
  static objects = db.manager(Ticket)
  id = models.ID()
  title = models.Text()
  relatedTaskId = models.ForeignKey(() => Task, {nullable: true, onDelete: 'set null'})
  declare relatedTask: Relation<Task>
}
new Pylon({name: 'tickets', db: {models: [Ticket]}})

class Task extends models.Model {
  static config = {table: 'app_task'} satisfies ModelConfig<Task>
  static objects = db.manager(Task)
  id = models.ID()
  name = models.Text()
  relatedTicketId = models.ForeignKey(() => Ticket, {nullable: true, onDelete: 'set null'})
  declare relatedTicket: Relation<Ticket>
}
new Pylon({name: 'tasks', db: {models: [Task]}})

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

  it('orders a DAG, and TOLERATES a mutual cross-app cycle (no throw)', () => {
    // A legit mutual cross-app FK (e.g. tickets↔tasks) makes the groups mutually
    // dependent. That must NOT throw here — the interleaved apply resolves the real
    // order at migration granularity; this only needs a deterministic best-effort.
    const a: MigrationGroup = {name: 'a', dependencies: ['b']}
    const b: MigrationGroup = {name: 'b', dependencies: ['a']}
    const c: MigrationGroup = {name: 'c', dependencies: ['a']}
    const ordered = orderGroups([c, a, b])
    expect(ordered.map(g => g.name).sort()).toEqual(['a', 'b', 'c'])
    // the acyclic edge is still honoured: c comes after its dep a
    expect(ordered.findIndex(g => g.name === 'c')).toBeGreaterThan(
      ordered.findIndex(g => g.name === 'a')
    )
    // an UNKNOWN dependency is still a hard error
    expect(() => orderGroups([{name: 'x', dependencies: ['missing']}])).toThrow(/unknown group/)
  })

  it('emits BOTH cross-app FK constraints for a mutual cycle (NOT soft columns)', async () => {
    // Empirical check on the claim that a cross-app FK forming an app cycle gets
    // downgraded to a constraint-less "soft" column. It does not: `groupRunner`
    // resolves each group's FK targets against the GLOBAL universe, so each side's
    // generated migration still emits a real `addForeignKey` to the other app's
    // table. The cyclic group graph exists PRECISELY because those FKs are real.
    const byName = Object.fromEntries(appGroups().map(g => [g.name, g]))
    expect(byName.tickets.dependencies).toContain('tasks') // inferred from the real FK
    expect(byName.tasks.dependencies).toContain('tickets') // …in both directions ⇒ cycle

    const ticketsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-fk-tickets-'))
    const tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-fk-tasks-'))
    try {
      const now = () => '20260101T000000'
      const ticketsMig = await generateGroup({...byName.tickets, dir: ticketsDir}, 'init', load, {now})
      const tasksMig = await generateGroup({...byName.tasks, dir: tasksDir}, 'init', load, {now})

      // Pull the FK specs out of each group's generated migration changes.
      const fks = (m: {changes: Array<{kind: string; fk?: unknown}>} | null) =>
        (m?.changes ?? []).filter(c => c.kind === 'addForeignKey').map(c => c.fk)

      // tickets → tasks: a REAL constraint on app_ticket.related_task_id → app_task.
      expect(fks(ticketsMig)).toContainEqual(
        expect.objectContaining({
          table: 'app_ticket',
          column: 'related_task_id',
          refTable: 'app_task',
          onDelete: 'set null'
        })
      )
      // tasks → tickets: the mirror constraint. Both materialize — neither is dropped.
      expect(fks(tasksMig)).toContainEqual(
        expect.objectContaining({
          table: 'app_task',
          column: 'related_ticket_id',
          refTable: 'app_ticket',
          onDelete: 'set null'
        })
      )
    } finally {
      await fs.rm(ticketsDir, {recursive: true, force: true})
      await fs.rm(tasksDir, {recursive: true, force: true})
    }
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
      // derive groups, then give each a (temp) migrations dir. Scope to THIS
      // block's apps — other suites register their own apps into the same registry.
      const dirs: Record<string, string> = {accounts: accountsDir, billing: billingDir}
      groups = appGroups()
        .filter(g => dirs[g.name])
        .map(g => ({...g, dir: dirs[g.name]}))
      await cleanDb()
      const now = () => '20260101T000000' // identical file name in both → ledger collision test
      // Generate in dependency order + pass siblings so a cross-app reference becomes a
      // persisted [app, migration] tuple (the depended app is already on disk).
      for (const g of orderGroups(groups)) await generateGroup(g, 'init', load, {now, siblings: groups})
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

    it('status reports nothing pending; re-applying is a no-op', async () => {
      expect(await statusGroups(groups, load, database)).toEqual([
        {group: 'accounts', pendingChanges: 0, pending: [], unapplied: []},
        {group: 'billing', pendingChanges: 0, pending: [], unapplied: []}
      ])
      // Re-applying is a no-op (idempotent); the uncaptured-changes guard that
      // `deployGroups` used to bundle now lives in `pylon db migrate --check`.
      expect(await migrateGroups(groups, load, database)).toEqual([
        {group: 'accounts', applied: []},
        {group: 'billing', applied: []}
      ])
    })
  })
})

/**
 * Runtime enforcement of a MUTUAL cross-app FK (tickets↔tasks) on a real Postgres.
 * Proves the two constraints are not "soft" columns but real, DB-enforced FKs —
 * AND that the staged (production-shape) migration set applies through the cyclic
 * group graph via the cycle-tolerant `orderGroups` + interleaved apply.
 *
 * The two FK directions are deliberately staged across migrations (tickets:init
 * FKs tasks, then a later tasks migration FKs back to tickets). Both directions in
 * the two INITs would be genuinely unresolvable — each init would need the other's
 * table before it exists — and `applyGroupsInterleaved` rightly rejects that. The
 * "one side added later" staging is exactly how such a cycle arises in practice.
 */
describe.skipIf(!runDb)('mutual cross-app FK enforced at the database (Postgres)', () => {
  let database: Database
  let ticketsDir: string
  let tasksDir: string
  let groups: MigrationGroup[]
  let applied: Awaited<ReturnType<typeof migrateGroups>>

  const cleanDb = async () => {
    await database.kysely.schema.dropTable('app_ticket').ifExists().cascade().execute()
    await database.kysely.schema.dropTable('app_task').ifExists().cascade().execute()
    for (const p of ['tickets:%', 'tasks:%']) {
      await database.kysely
        .deleteFrom('_pylon_migrations' as never)
        .where('name' as never, 'like', p as never)
        .execute()
        .catch(() => {})
    }
  }

  // Drop every `belongsTo` FK from a snapshot (keeping the scalar FK columns) — so a
  // stage-1 migration creates the table WITHOUT the constraint, which a later
  // migration then adds. That is what makes the mutual cycle applyable.
  const withoutForeignKeys = (snap: Snapshot): Snapshot => ({
    version: snap.version,
    entities: Object.fromEntries(
      Object.entries(snap.entities).map(([name, e]) => [
        name,
        {...e, fields: e.fields.filter(f => f.relation?.kind !== 'belongsTo')}
      ])
    )
  })

  beforeAll(async () => {
    database = connect({connectionString})
    ticketsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-cyc-tickets-'))
    tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-cyc-tasks-'))
    await cleanDb()

    const ticketDef = getModelDefinitionOrThrow(Ticket)
    const taskDef = getModelDefinitionOrThrow(Task)
    const snapOf = (def: typeof ticketDef): Snapshot => {
      const ir = toIR([def])
      return {version: ir.version, entities: ir.entities}
    }
    // Monotonic timestamps shared across both runners so file order is deterministic.
    let n = 0
    const now = () => `20260101T${String(++n).padStart(6, '0')}`
    // When false, the tasks snapshot omits its back-FK (stage 1); flipped on for the
    // follow-up migration that adds it (stage 3).
    let tasksHasBackFk = false

    const ticketsRunner = new MigrationRunner({
      dir: ticketsDir,
      current: () => snapOf(ticketDef),
      resolveAgainst: () => toIR().entities, // the whole registry — cross-app FK resolves
      ledgerPrefix: 'tickets',
      now
    })
    const tasksRunner = new MigrationRunner({
      dir: tasksDir,
      current: () => (tasksHasBackFk ? snapOf(taskDef) : withoutForeignKeys(snapOf(taskDef))),
      resolveAgainst: () => toIR().entities,
      ledgerPrefix: 'tasks',
      now
    })

    // Stage the two FK directions into separate migrations (the applyable shape).
    await tasksRunner.generate('init', load) // app_task (+ related_ticket_id col, no FK)
    await ticketsRunner.generate('init', load) // app_ticket + FK → app_task
    tasksHasBackFk = true
    await tasksRunner.generate('add_related_ticket_fk', load) // FK app_task → app_ticket

    const byName = Object.fromEntries(appGroups().map(g => [g.name, g]))
    groups = [
      {...byName.tickets, dir: ticketsDir},
      {...byName.tasks, dir: tasksDir}
    ]
    // Applies through the CYCLIC group graph (orderGroups tolerates it; the
    // interleaved apply finds the real per-migration order).
    applied = await migrateGroups(groups, load, database)
  })

  afterAll(async () => {
    if (database) {
      await cleanDb()
      await database.destroy()
    }
    setDefaultDatabase(undefined)
    await fs.rm(ticketsDir, {recursive: true, force: true})
    await fs.rm(tasksDir, {recursive: true, force: true})
  })

  it('applies the staged mutual cycle without a cross-group cycle error', () => {
    const byGroup = Object.fromEntries(applied.map(r => [r.group, r.applied.length]))
    expect(byGroup.tickets).toBe(1) // init
    expect(byGroup.tasks).toBe(2) // init + add_related_ticket_fk
  })

  it('enforces BOTH cross-app FK constraints (neither is a soft column)', async () => {
    const task = await Task.objects.create({name: 'build'})
    const ticket = await Ticket.objects.create({title: 'bug', relatedTaskId: task.id})
    await Task.objects.filter({id: task.id}).update({relatedTicketId: ticket.id})

    // Both directions resolve to the linked row's id — the columns hold real refs.
    expect((await Ticket.objects.get({id: ticket.id})).relatedTaskId).toBe(task.id)
    expect((await Task.objects.get({id: task.id})).relatedTicketId).toBe(ticket.id)

    // A dangling reference in EITHER direction is rejected by Postgres.
    await expect(
      Ticket.objects.create({title: 'x', relatedTaskId: 9_999_999})
    ).rejects.toThrow(/foreign key|violates|app_ticket_related_task_id/i)
    await expect(
      Task.objects.create({name: 'y', relatedTicketId: 9_999_999})
    ).rejects.toThrow(/foreign key|violates|app_task_related_ticket_id/i)
  })

  it('carries ON DELETE SET NULL across the app boundary', async () => {
    const task = await Task.objects.create({name: 'ship'})
    const ticket = await Ticket.objects.create({title: 'release', relatedTaskId: task.id})
    await Task.objects.filter({id: task.id}).update({relatedTicketId: ticket.id})

    // Deleting the ticket nulls the tasks-side FK — proving the constraint carries
    // its referential action, not just its presence.
    await Ticket.objects.filter({id: ticket.id}).delete()
    expect((await Task.objects.get({id: task.id})).relatedTicketId).toBeNull()
  })
})

/**
 * The persisted cross-app dependency graph (RFC phase 1): cross-app ordering is a
 * `[app, migration]` tuple in the file, not derived at apply. A tuple naming no such
 * migration must fail LOUDLY — there is no derivation to silently cover the gap.
 */
describe.skipIf(!runDb)('persisted cross-app dependency graph (Postgres)', () => {
  let database: Database
  let dirA: string
  let dirB: string
  const mig = (body: string) =>
    `import {migrations} from '@getcronit/pylon/db'\n` +
    `export default migrations.defineMigration(${body})\n`

  beforeAll(async () => {
    database = connect({connectionString})
    dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-xapp-a-'))
    dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-xapp-b-'))
  })
  afterAll(async () => {
    if (database) await database.destroy()
    setDefaultDatabase(undefined)
    await fs.rm(dirA, {recursive: true, force: true})
    await fs.rm(dirB, {recursive: true, force: true})
  })

  it('fails loudly on a cross-app dependency naming a migration that does not exist', async () => {
    await fs.writeFile(path.join(dirA, '20260101T000000_init.ts'), mig(`{operations: []}`))
    await fs.writeFile(
      path.join(dirB, '20260101T000001_uses.ts'),
      mig(`{dependencies: [['a', '20260101T999999_missing']], operations: []}`)
    )
    const groups: MigrationGroup[] = [
      {name: 'a', dir: dirA, models: []},
      {name: 'b', dir: dirB, models: [], dependencies: ['a']}
    ]
    // The dangling edge is caught during graph construction, before anything applies.
    await expect(migrateGroups(groups, load, database)).rejects.toThrow(
      /b:20260101T000001_uses.*a:20260101T999999_missing.*does not exist/s
    )
  })

  it('rename-app rewrites cross-app dependency tuples in dependents', async () => {
    const a = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-ren-a-'))
    const b = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-ren-b-'))
    try {
      await fs.writeFile(path.join(a, '20260101T000000_init.ts'), mig(`{operations: []}`))
      const bFile = path.join(b, '20260101T000001_uses.ts')
      // b depends on 'a' via an explicit cross-app tuple (single-quoted, hand-authored).
      await fs.writeFile(
        bFile,
        mig(`{dependencies: [['a', '20260101T000000_init']], operations: []}`)
      )
      // 'a' was renamed to 'newa' in code → groups carry the NEW name on the same dir.
      const groups: MigrationGroup[] = [
        {name: 'newa', dir: a, models: []},
        {name: 'b', dir: b, models: [], dependencies: ['newa']}
      ]
      const rows = await renameGroupApp(groups, 'a', 'newa', load, database)
      // The dependent's tuple is re-pointed to the new app name in the FILE itself,
      // so it no longer dangles (would otherwise fail loudly at the next migrate).
      const after = await fs.readFile(bFile, 'utf8')
      expect(after).toContain('[["newa","20260101T000000_init"]]')
      expect(after).not.toMatch(/\[\s*['"]a['"]/) // the old [a, …] tuple is gone
      expect(typeof rows).toBe('number') // ledger re-point ran (0 here — nothing applied)
    } finally {
      await fs.rm(a, {recursive: true, force: true})
      await fs.rm(b, {recursive: true, force: true})
    }
  })

  it('squash cascades: a sibling’s cross-app tuple re-points to the squashed migration', async () => {
    const a = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-sq-a-'))
    const b = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-sq-b-'))
    try {
      // app 'a' has a two-migration history…
      await fs.writeFile(path.join(a, '20260101T000000_init.ts'), mig(`{operations: []}`))
      await fs.writeFile(
        path.join(a, '20260101T000001_more.ts'),
        mig(`{dependencies: ['20260101T000000_init'], operations: []}`)
      )
      // …and app 'b' pins a cross-app edge to a's SECOND migration.
      const bFile = path.join(b, '20260101T000002_uses.ts')
      await fs.writeFile(
        bFile,
        mig(`{dependencies: [['a', '20260101T000001_more']], operations: []}`)
      )
      const groups: MigrationGroup[] = [
        {name: 'a', dir: a, models: []},
        {name: 'b', dir: b, models: [], dependencies: ['a']}
      ]
      const result = await squashGroups(groups, 'a', load, 'squashed')
      expect(result).not.toBeNull()
      // a's two migrations collapsed into one…
      expect((await fs.readdir(a)).filter(f => f.endsWith('.ts'))).toHaveLength(1)
      // …and b's edge re-points to the squashed migration (no dangling tuple).
      const after = await fs.readFile(bFile, 'utf8')
      expect(after).toContain(`[["a","${result!.name}"]]`)
    } finally {
      await fs.rm(a, {recursive: true, force: true})
      await fs.rm(b, {recursive: true, force: true})
    }
  })
})
