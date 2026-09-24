import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  enumOf,
  getModelDefinitionOrThrow,
  id,
  int,
  numeric,
  text,
  varchar
} from '@/db/index'

// Dual projection: the SAME min/max/enum rules the runtime validator enforces
// are also emitted as a DB CHECK (defense-in-depth). `pattern`/`email` are
// JS-only (no faithful POSIX translation), so they must NOT appear in a CHECK.
class Product extends Model {
  id = id()
  price = numeric({min: 0}) // numeric lower bound
  qty = int({min: 1, max: 999}) // numeric range
  sku = text({min: 3, max: 12}) // string length range → char_length
  status = enumOf(['draft', 'live'] as const) // enum membership
  code = varchar(20, {min: 2, check: "code <> 'XX'"}) // enum-less + min + explicit
  email = text({email: true, pattern: /x/}) // JS-only — no CHECK
  plain = text() // no constraints — no CHECK
}
new Pylon({db: {models: [Product]}})

const cols = Object.fromEntries(
  getModelDefinitionOrThrow(Product).columns.map(c => [c.propertyKey, c])
)

describe('CHECK projection (dual projection of validation rules)', () => {
  it('projects a numeric lower bound', () => {
    expect(cols.price.check).toBe('"price" >= 0')
  })

  it('projects a numeric range as two AND-ed clauses', () => {
    expect(cols.qty.check).toBe('("qty" >= 1) AND ("qty" <= 999)')
  })

  it('projects string min/max as char_length bounds', () => {
    expect(cols.sku.check).toBe('(char_length("sku") >= 3) AND (char_length("sku") <= 12)')
  })

  it('projects enum membership as IN (…)', () => {
    expect(cols.status.check).toBe(`"status" IN ('draft', 'live')`)
  })

  it('combines a projected min with an explicit author check', () => {
    expect(cols.code.check).toBe(`(char_length("code") >= 2) AND (code <> 'XX')`)
  })

  it('does NOT project pattern/email into a CHECK (JS-only rules)', () => {
    expect(cols.email.check).toBeUndefined()
  })

  it('leaves an unconstrained column with no CHECK', () => {
    expect(cols.plain.check).toBeUndefined()
  })
})
