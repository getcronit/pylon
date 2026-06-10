import {describe, expect, it} from 'vitest'
import {z} from 'zod'
import {
  Model,
  getModelDefinitionOrThrow,
  id,
  json,
  model,
  text,
  validateInstance,
  validateWithSchema,
  type FieldSchema
} from '../src/index'

@model()
class Profile extends Model {
  id = id()
  // Standard Schema (Zod) on a field — richer than the built-in email rule.
  email = text({schema: z.string().email()})
  // Built-in rule + schema coexist on one field.
  handle = text({min: 2, schema: z.string().regex(/^[a-z]+$/, 'lowercase only')})
  // Schema on a JSON column — nested issue paths dot under the field.
  address = json({schema: z.object({zip: z.string().min(5)})})
}
const def = getModelDefinitionOrThrow(Profile)

describe('Standard Schema field adapter (Zod)', () => {
  it('maps a Zod failure to a structured `custom` issue rooted at the field', () => {
    const issues = validateInstance(def, {email: 'nope', handle: 'ok', address: {zip: '12345'}})
    const email = issues.find(i => i.path === 'email')
    expect(email?.code).toBe('custom')
    expect(email?.message).toBeTypeOf('string')
    expect(email?.message.length).toBeGreaterThan(0)
  })

  it('a valid instance produces no issues', () => {
    expect(
      validateInstance(def, {email: 'a@b.co', handle: 'ada', address: {zip: '12345'}})
    ).toEqual([])
  })

  it('built-in rules and the schema both run on the same field', () => {
    // handle = 'A' fails the built-in min(2) (length) AND the zod lowercase regex.
    const issues = validateInstance(def, {email: 'a@b.co', handle: 'A', address: {zip: '12345'}})
    const codes = issues.filter(i => i.path === 'handle').map(i => i.code)
    expect(codes).toContain('length') // built-in
    expect(codes).toContain('custom') // zod regex
  })

  it('nested object-schema issues are dotted under the field path', () => {
    const issues = validateInstance(def, {email: 'a@b.co', handle: 'ok', address: {zip: '1'}})
    const nested = issues.find(i => i.path === 'address.zip')
    expect(nested?.code).toBe('custom')
  })

  it('validateWithSchema works directly with a Zod schema (Standard Schema path)', () => {
    expect(validateWithSchema('age', z.number().min(18), 10)).toMatchObject([
      {path: 'age', code: 'custom'}
    ])
    expect(validateWithSchema('age', z.number().min(18), 21)).toEqual([])
  })

  it('falls back to a classic `safeParse` schema (pre-Standard-Schema Zod)', () => {
    const classic: FieldSchema = {
      safeParse: (v: unknown) =>
        v === 'good'
          ? {success: true, data: v}
          : {success: false, error: {issues: [{message: 'bad', path: []}]}}
    }
    expect(validateWithSchema('field', classic, 'good')).toEqual([])
    expect(validateWithSchema('field', classic, 'x')).toEqual([
      {path: 'field', code: 'custom', message: 'bad'}
    ])
  })

  it('throws a clear error for an async schema', () => {
    const asyncSchema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => Promise.resolve({value: undefined, issues: [{message: 'x'}]})
      }
    }
    expect(() => validateWithSchema('field', asyncSchema as FieldSchema, 1)).toThrow(/async schema/i)
  })
})
