/**
 * The dialect seam. Pylon targets **Postgres** (a deliberate decision — the ORM
 * leans into Postgres strengths: arrays, full-text `tsvector`/GIN, `jsonb`,
 * `SKIP LOCKED`, advisory locks). This module is the single place the
 * Postgres-specific *DDL* fragments live, so the migration renderer (`ddl.ts`,
 * `diff.ts`) stays dialect-agnostic and a future SQLite/D1 adapter has one small
 * interface to implement rather than scattered string literals to hunt down.
 *
 * Postgres-isms that live OUTSIDE this module (their own override points, marked
 * `Postgres-specific (dialect override point)` in code) — listed here so an
 * adapter author has the full checklist:
 *   • pylon-db `schema-sync.ts` `pgColumnType` — the `db push` (kysely) renderer,
 *     parallel to this DDL renderer (`serial`/`bigserial`, `text[]`, `tsvector`,
 *     stored generated columns).
 *   • pylon-db `fields.ts` — `uuid({primaryKey})` defaults to `gen_random_uuid()`.
 *   • pylon-db `migration-runner.ts` — `pg_advisory_lock` serializes migrations.
 *   • pylon-queues `pg-outbox.ts` — `FOR UPDATE SKIP LOCKED` claim.
 *   • `tsvector`/GIN/`websearch_to_tsquery` — tagged `requires: 'postgres'` in the IR.
 *   • pylon-db `manager.ts` `compileField` / `.search()` — the WhereInput query
 *     compiler: `ILIKE` (case-insensitive `mode`), array ops (`= ANY`, `&&`, `@>`,
 *     `array_length`), and FTS `websearch_to_tsquery` / `ts_rank` ordering.
 */
import type {ColumnSpec} from './ir.js'

export interface Dialect {
  /** Bare column type incl. modifiers: `varchar(n)`, `numeric(p,s)`, `text[]`, … */
  columnType(c: ColumnSpec): string
  /** Full clause for an auto-increment primary key (after the quoted name). */
  autoIncrementPrimaryKey(): string
  /** Stored generated-column clause (placed after the column type). */
  generatedColumn(expr: string): string
  /** Index access-method clause, e.g. ` USING gin` (empty for the default btree). */
  indexMethod(method?: 'gin' | 'btree'): string
}

export const postgres: Dialect = {
  columnType(c) {
    let base: string = c.sqlType
    if (c.sqlType === 'varchar' && c.length) base = `varchar(${c.length})`
    else if (c.sqlType === 'numeric' && c.precision != null) {
      base =
        c.scale != null
          ? `numeric(${c.precision}, ${c.scale})`
          : `numeric(${c.precision})`
    }
    return c.array ? `${base}[]` : base
  },
  autoIncrementPrimaryKey: () => 'bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY',
  generatedColumn: expr => `GENERATED ALWAYS AS (${expr}) STORED`,
  indexMethod: method => (method && method !== 'btree' ? ` USING ${method}` : '')
}
