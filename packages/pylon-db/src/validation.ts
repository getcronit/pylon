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

  if (isStringType(col.sqlType) && typeof value !== 'string') {
    issue('type', `${path} must be a string`, {expected: 'string'})
    return out
  }
  if (isNumberType(col.sqlType) && typeof value !== 'number') {
    issue('type', `${path} must be a number`, {expected: 'number'})
    return out
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

  return out
}

/** Validate an instance against its model definition; returns all issues. */
export function validateInstance(def: ModelDefinition, instance: object): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const col of def.columns) {
    issues.push(...validateColumn(col, (instance as Record<string, unknown>)[col.propertyKey]))
  }
  return issues
}
