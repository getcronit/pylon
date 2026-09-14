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
  indexMethod(method?: 'gin' | 'btree' | 'hnsw' | 'ivfflat'): string
  /** Index storage-parameter clause, e.g. ` WITH (m = 16, ef_construction = 64)`
   *  (empty when no params). Values are inlined — storage params take no binds. */
  indexWith(params?: Record<string, number>): string
  /**
   * Whether `ALTER COLUMN … TYPE` can convert `before` to `after` on its own.
   * When false the statement needs an explicit `USING <expr>`; without one
   * Postgres aborts the migration with "cannot be cast automatically".
   */
  castsImplicitly(before: ColumnSpec, after: ColumnSpec): boolean
}

/**
 * Which type changes Postgres performs without a `USING` expression. Determined
 * empirically against Postgres 16 (`ALTER TABLE … ALTER COLUMN … TYPE` over every
 * pair of types the IR can emit), not from the cast catalog — `pg_cast` describes
 * expression casts, while ALTER TYPE additionally accepts I/O conversions to the
 * string types. The four rules below reproduce that matrix exactly.
 */
const STRING_TYPES = new Set(['text', 'varchar'])
const NUMERIC_TYPES = new Set(['integer', 'bigint', 'numeric'])
const TEMPORAL_TYPES = new Set(['timestamptz', 'date'])

export const postgres: Dialect = {
  columnType(c) {
    let base: string = c.sqlType
    if (c.sqlType === 'varchar' && c.length) base = `varchar(${c.length})`
    else if (c.sqlType === 'numeric' && c.precision != null) {
      base =
        c.scale != null
          ? `numeric(${c.precision}, ${c.scale})`
          : `numeric(${c.precision})`
    } else if (c.sqlType === 'vector' && c.dim != null) base = `vector(${c.dim})`
    return c.array ? `${base}[]` : base
  },
  autoIncrementPrimaryKey: () => 'bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY',
  generatedColumn: expr => `GENERATED ALWAYS AS (${expr}) STORED`,
  indexMethod: method => (method && method !== 'btree' ? ` USING ${method}` : ''),
  indexWith: params => {
    if (!params) return ''
    const body = Object.entries(params)
      .map(([k, v]) => {
        // Storage-param names + values are inlined (no bind params in WITH), so
        // validate to keep the DDL injection-safe.
        if (!/^[a-z_][a-z0-9_]*$/i.test(k))
          throw new Error(`invalid index storage-param name: ${JSON.stringify(k)}`)
        if (typeof v !== 'number' || !Number.isFinite(v))
          throw new Error(`invalid index storage-param value for "${k}": ${String(v)}`)
        return `${k} = ${v}`
      })
      .join(', ')
    return body ? ` WITH (${body})` : ''
  },
  castsImplicitly(before, after) {
    // Scalar → array never converts on its own (`text` → `text[]` needs an
    // explicit expression). The reverse does: an array degrades to its text form.
    if (after.array && !before.array) return false
    // Otherwise the element types decide, and the rules apply the same whether or
    // not both sides are arrays (`integer[]` → `text[]` casts, `text[]` →
    // `integer[]` does not).
    if (before.sqlType === after.sqlType) return true // width/precision/dim only
    if (STRING_TYPES.has(after.sqlType)) return true // anything → text/varchar
    if (NUMERIC_TYPES.has(before.sqlType) && NUMERIC_TYPES.has(after.sqlType)) return true
    if (TEMPORAL_TYPES.has(before.sqlType) && TEMPORAL_TYPES.has(after.sqlType)) return true
    return false
  }
}
