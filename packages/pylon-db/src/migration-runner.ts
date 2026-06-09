/**
 * Migration workflow — the file/DB-bound orchestration on top of the pure IR
 * diff engine. A directory holds:
 *
 *   migrations/
 *     snapshot.json              latest IR baseline (entities)
 *     20260609T120000_init.json  { name, up[], down[], changes }
 *
 * `generate` diffs the baseline snapshot against the current models and writes a
 * timestamped migration + advances the baseline. `apply` runs unapplied
 * migrations in order inside a transaction, tracking them in `_pylon_migrations`
 * so re-runs are idempotent. You diff IR snapshots — never the live database.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {sql} from 'kysely'
import {makeMigration, diffEntities, type SchemaChange} from '@getcronit/pylon-ir'
import {getDatabase, type Database} from './database.js'
import {snapshot, type Snapshot} from './migrations.js'

const EMPTY: Snapshot = {version: 1, entities: {}}
const APPLIED_TABLE = '_pylon_migrations'

export interface MigrationFile {
  name: string
  up: string[]
  down: string[]
  changes: SchemaChange[]
}

export interface MigrationRunnerOptions {
  /** Directory holding `snapshot.json` and the migration files. */
  dir: string
  /** Current schema provider (defaults to the live ORM registry snapshot). */
  current?: () => Snapshot
  /** Timestamp prefix generator for filenames (injectable for tests). */
  now?: () => string
}

function defaultStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
}

export class MigrationRunner {
  private readonly dir: string
  private readonly current: () => Snapshot
  private readonly now: () => string

  constructor(options: MigrationRunnerOptions) {
    this.dir = options.dir
    this.current = options.current ?? snapshot
    this.now = options.now ?? defaultStamp
  }

  private get snapshotPath(): string {
    return path.join(this.dir, 'snapshot.json')
  }

  async loadBaseline(): Promise<Snapshot> {
    try {
      return JSON.parse(await fs.readFile(this.snapshotPath, 'utf8')) as Snapshot
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw e
    }
  }

  /** Migration files on disk, chronological (timestamp-prefixed names sort). */
  async list(): Promise<MigrationFile[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    const files = entries
      .filter(f => f.endsWith('.json') && f !== 'snapshot.json')
      .sort()
    return Promise.all(
      files.map(
        async f =>
          JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8')) as MigrationFile
      )
    )
  }

  /**
   * Diff the baseline against the current models and, if anything changed,
   * write a timestamped migration and advance the baseline snapshot. Returns
   * the written migration, or `null` when there is nothing to do.
   */
  async generate(name: string): Promise<MigrationFile | null> {
    const prev = await this.loadBaseline()
    const next = this.current()
    const {up, down, changes, unsupported} = makeMigration(
      prev.entities,
      next.entities
    )
    if (changes.length === 0) return null

    const file: MigrationFile = {name: `${this.now()}_${name}`, up, down, changes}
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(
      path.join(this.dir, `${file.name}.json`),
      JSON.stringify({...file, unsupported}, null, 2)
    )
    await fs.writeFile(this.snapshotPath, JSON.stringify(next, null, 2))
    return file
  }

  /** Uncaptured changes (baseline vs current) + which files are unapplied. */
  async status(db?: Database): Promise<{
    pendingChanges: SchemaChange[]
    migrations: string[]
    unapplied: string[]
  }> {
    const prev = await this.loadBaseline()
    const pendingChanges = diffEntities(prev.entities, this.current().entities)
    const files = await this.list()
    const names = files.map(f => f.name)
    let unapplied = names
    if (db) {
      const applied = await this.appliedNames(db)
      unapplied = names.filter(n => !applied.has(n))
    }
    return {pendingChanges, migrations: names, unapplied}
  }

  private async ensureTable(db: Database): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE IF NOT EXISTS "${APPLIED_TABLE}" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
      )
      .execute(db.kysely)
  }

  private async appliedNames(db: Database): Promise<Set<string>> {
    await this.ensureTable(db)
    const rows = await sql<{name: string}>`SELECT name FROM ${sql.ref(
      APPLIED_TABLE
    )}`.execute(db.kysely)
    return new Set(rows.rows.map(r => r.name))
  }

  /** Apply every unapplied migration in order; idempotent. Returns the names run. */
  async apply(db: Database = getDatabase()): Promise<string[]> {
    await this.ensureTable(db)
    const applied = await this.appliedNames(db)
    const pending = (await this.list()).filter(f => !applied.has(f.name))

    for (const migration of pending) {
      await db.kysely.transaction().execute(async trx => {
        for (const stmt of migration.up) {
          await sql.raw(stmt).execute(trx)
        }
        await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name) VALUES (${
          migration.name
        })`.execute(trx)
      })
    }
    return pending.map(f => f.name)
  }
}
