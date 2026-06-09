/**
 * Migration runner — the stateful, filesystem/DB-bound half of Phase 4. The
 * pure diff/SQL engine lives in `@getcronit/pylon-ir` (`makeMigration`); this
 * module snapshots the current models as IR, persists/loads snapshots, and
 * applies the generated SQL via Kysely.
 *
 * A snapshot is just the serialized `entities` slice of the IR — you diff IR
 * snapshots, never the live database.
 */
import {promises as fs} from 'node:fs'
import {sql} from 'kysely'
import {makeMigration, type Migration, type PylonIR} from '@getcronit/pylon-ir'
import {getDatabase, type Database} from './database.js'
import {toIR} from './ir.js'

export type Snapshot = Pick<PylonIR, 'version' | 'entities'>

const EMPTY: Snapshot = {version: 1, entities: {}}

/** The current schema as an IR snapshot (entities — the migratable surface). */
export function snapshot(): Snapshot {
  const ir = toIR()
  return {version: ir.version, entities: ir.entities}
}

export function serializeSnapshot(s: Snapshot): string {
  return JSON.stringify(s, null, 2)
}

/** Load a snapshot from disk, or `null` if none exists yet. */
export async function loadSnapshot(path: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as Snapshot
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function saveSnapshot(
  path: string,
  s: Snapshot = snapshot()
): Promise<void> {
  await fs.writeFile(path, serializeSnapshot(s))
}

/** Plan a migration from a stored snapshot (or nothing) to the current models. */
export function planMigration(
  prev: Snapshot | null,
  next: Snapshot = snapshot()
): Migration {
  return makeMigration((prev ?? EMPTY).entities, next.entities)
}

/** Apply a migration's `up` statements in order, inside a transaction. */
export async function applyMigration(
  migration: Migration,
  db: Database = getDatabase()
): Promise<void> {
  await db.kysely.transaction().execute(async trx => {
    for (const stmt of migration.up) {
      await sql.raw(stmt).execute(trx)
    }
  })
}
