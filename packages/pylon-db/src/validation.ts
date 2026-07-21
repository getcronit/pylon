/**
 * Runtime model validation — fail fast on writes with clear, structured errors,
 * derived from the same field metadata that drives the DB schema.
 *
 * Issues are STRUCTURED (stable `code` + `params` + an English default
 * `message`), never just a baked string — so they translate cleanly when
 * surfaced through the API (a client localizes from `code`+`params`; the English
 * `message` is the fallback). This module is locale-agnostic on purpose; i18n is
 * a boundary concern, not the ORM's job.
 */
import type {ColumnDefinition, ModelDefinition} from './registry.js'
import {resolveColumnSqlType} from './registry.js'
import {validateWithSchema} from './standard-schema.js'

/** Stable issue codes — these are the translation keys; treat them as API. */
export type ValidationCode =
  | 'required'
  | 'type'
  | 'min'
  | 'max'
  | 'length'
  | 'pattern'
  | 'email'
  | 'enum'
  | 'unique'
  | 'custom'

export interface ValidationIssue {
  /** Field property name (dotted for nested inputs, later). */
  path: string
  code: ValidationCode
  /** Constraint values for translation, e.g. `{max: 130}`. */
  params?: Record<string, unknown>
  /** English default — fallback / logs / dev. */
  message: string
}

export class ValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}): ` +
        issues.map(i => `${i.path}: ${i.message}`).join('; ')
    )
    this.name = 'ValidationError'
  }
}

/**
 * Map a Postgres unique-violation (SQLSTATE 23505) to a `'unique'`
 * `ValidationError` on the offending column(s) — so a duplicate surfaces as a
 * precise field-level userError (via `mutation()`) instead of a masked
 * "Unexpected error". Returns `undefined` for any other error. The columns are
 * read from the driver's `detail` (`Key (a, b)=(…) already exists.`) and mapped
 * back to model property names.
 */
export function uniqueViolation(
  def: ModelDefinition,
  err: unknown
): ValidationError | undefined {
  const e = err as {code?: string; detail?: string; constraint?: string}
  if (e?.code !== '23505') return undefined
  const cols =
    e.detail?.match(/^Key \(([^)]+)\)=/)?.[1]?.split(',').map(s =>
      s.replace(/"/g, '').trim()
    ) ?? []
  const props = cols.map(
    col => def.columns.find(c => c.columnName === col)?.propertyKey ?? col
  )
  const params = {constraint: e.constraint}
  if (props.length === 0) {
    return new ValidationError([
      {path: '', code: 'unique', message: 'A record with these values already exists.', params}
    ])
  }
  const combined = props.length > 1 ? `combination of ${props.join(', ')}` : props[0]
  return new ValidationError(
    props.map(p => ({
      path: p,
      code: 'unique' as const,
      message: `This ${combined} already exists.`,
      params
    }))
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isStringType = (t: string) => t === 'text' || t === 'varchar' || t === 'uuid'
const isNumberType = (t: string) => t === 'integer' || t === 'bigint' || t === 'numeric'

function validateColumn(col: ColumnDefinition, value: unknown): ValidationIssue[] {
  const path = col.propertyKey
  const out: ValidationIssue[] = []
  const issue = (code: ValidationCode, message: string, params?: Record<string, unknown>) =>
    out.push({path, code, message, params})

  if (value === undefined || value === null) {
    // A DB-generated / defaulted / nullable column may be absent.
    const optional =
      col.nullable || col.autoIncrement || col.primaryKey || col.default !== undefined || col.defaultSql
    if (!optional) issue('required', `${path} is required`)
    return out
  }

  // Array columns hold a list of the element type; validate array-ness and skip
  // the scalar element rules (min/max/pattern/email apply to scalar columns).
  if (col.array) {
    if (!Array.isArray(value)) issue('type', `${path} must be an array`, {expected: 'array'})
    return out
  }

  if (isStringType(col.sqlType) && typeof value !== 'string') {
    issue('type', `${path} must be a string`, {expected: 'string'})
    return out
  }
  if (isNumberType(col.sqlType)) {
    // Postgres returns `numeric`/`bigint` as a string (to preserve precision),
    // so a hydrated instance carries a numeric string — accept it on re-save.
    const numericString =
      (col.sqlType === 'numeric' || col.sqlType === 'bigint') &&
      typeof value === 'string' &&
      value.trim() !== '' &&
      Number.isFinite(Number(value))
    if (typeof value !== 'number' && !numericString) {
      issue('type', `${path} must be a number`, {expected: 'number'})
      return out
    }
  }
  if (col.sqlType === 'boolean' && typeof value !== 'boolean') {
    issue('type', `${path} must be a boolean`, {expected: 'boolean'})
    return out
  }

  if (col.enumValues && !col.enumValues.includes(value as string)) {
    issue('enum', `${path} must be one of: ${col.enumValues.join(', ')}`, {values: col.enumValues})
  }

  if (typeof value === 'string') {
    const max = col.max ?? col.length
    if (col.min !== undefined && value.length < col.min)
      issue('length', `${path} must be at least ${col.min} character(s)`, {min: col.min})
    if (max !== undefined && value.length > max)
      issue('length', `${path} must be at most ${max} character(s)`, {max})
    if (col.pattern && !col.pattern.test(value))
      issue('pattern', `${path} has an invalid format`, {pattern: col.pattern.source})
    if (col.email && !EMAIL_RE.test(value)) issue('email', `${path} must be a valid email`)
  }

  if (typeof value === 'number') {
    if (col.min !== undefined && value < col.min)
      issue('min', `${path} must be at least ${col.min}`, {min: col.min})
    if (col.max !== undefined && value > col.max)
      issue('max', `${path} must be at most ${col.max}`, {max: col.max})
  }

  if (col.validate) {
    const result = col.validate(value)
    if (result !== true) issue('custom', typeof result === 'string' ? result : `${path} is invalid`)
  }

  // Bring-your-own schema (Zod/Valibot/ArkType via Standard Schema) — runs last,
  // on a present, type-correct value; the library owns the message.
  if (col.schema) out.push(...validateWithSchema(path, col.schema, value))

  return out
}

/** Validate an instance against its model definition; returns all issues. */
export function validateInstance(
  def: ModelDefinition,
  instance: object,
  opts: {created?: boolean} = {}
): ValidationIssue[] {
  const created = opts.created ?? true
  const issues: ValidationIssue[] = []
  for (const col of def.columns) {
    // The primary key is immutable — on UPDATE it's already persisted and valid,
    // so re-running its (possibly format-strict) validators would wrongly reject
    // rows created under a different id scheme (e.g. a cuid → snowflake switch).
    if (!created && col.primaryKey) continue
    // FK columns store a `bigint` fallback but follow the target PK's type
    // (e.g. a cuid `text`); validate against the resolved type.
    const resolved = col.fkInferType
      ? {...col, sqlType: resolveColumnSqlType(def, col)}
      : col
    issues.push(...validateColumn(resolved, (instance as Record<string, unknown>)[col.propertyKey]))
  }
  return issues
}
