import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  enumOf,
  getModelDefinitionOrThrow,
  id,
  int,
  text,
  validateInstance,
  ValidationError
} from '../src/index'

class Account extends Model {
  id = id()
  email = text({email: true, max: 50})
  age = int({min: 0, max: 130})
  role = enumOf(['admin', 'user'] as const)
  username = text({min: 3, pattern: /^[a-z0-9_]+$/})
  bio = text({nullable: true})
  slug = text({validate: v => /^[a-z-]+$/.test(v as string) || 'must be kebab-case'})
}
new Pylon({db: {models: [Account]}})
const def = getModelDefinitionOrThrow(Account)

describe('validateInstance — structured issues (code + params)', () => {
  it('reports the right code/params per failing rule', () => {
    const issues = validateInstance(def, {
      email: 'nope',
      age: 200,
      role: 'root',
      username: 'a',
      slug: 'Not A Slug'
    })
    const by = Object.fromEntries(issues.map(i => [i.path, i]))
    expect(by.email.code).toBe('email')
    expect(by.age.code).toBe('max')
    expect(by.age.params).toEqual({max: 130})
    expect(by.role.code).toBe('enum')
    expect(by.role.params).toEqual({values: ['admin', 'user']})
    expect(by.username.code).toBe('length')
    expect(by.username.params).toEqual({min: 3})
    expect(by.slug).toMatchObject({code: 'custom', message: 'must be kebab-case'})
  })

  it('a valid instance has no issues', () => {
    expect(
      validateInstance(def, {
        email: 'a@b.co',
        age: 30,
        role: 'admin',
        username: 'alice',
        slug: 'ok-slug'
      })
    ).toEqual([])
  })

  it('required: a non-nullable, non-default field that is absent', () => {
    const issues = validateInstance(def, {age: 30, role: 'admin', username: 'alice', slug: 'x'})
    expect(issues.find(i => i.path === 'email')?.code).toBe('required')
  })

  it('a nullable field may be absent; an autoIncrement PK is never required', () => {
    const issues = validateInstance(def, {
      email: 'a@b.co',
      age: 1,
      role: 'user',
      username: 'bob',
      slug: 'x'
    })
    expect(issues.find(i => i.path === 'bio')).toBeUndefined()
    expect(issues.find(i => i.path === 'id')).toBeUndefined()
  })

  it('ValidationError carries the issues + a readable message', () => {
    const err = new ValidationError([{path: 'age', code: 'max', message: 'too big', params: {max: 1}}])
    expect(err.issues).toHaveLength(1)
    expect(err.message).toMatch(/age: too big/)
  })
})

// A model with a format-strict PRIMARY KEY validator (the general case behind the
// snowflake PK migration): a supplied id must be digits-only.
class Coded extends Model {
  id = text({primaryKey: true, validate: v => /^[0-9]+$/.test(String(v)) || 'digits only'})
  title = text({min: 1})
}
new Pylon({db: {models: [Coded]}})
const codedDef = getModelDefinitionOrThrow(Coded)

describe('primary-key validation on create vs update', () => {
  const bad = {id: 'legacy-cuid', title: 'Hi'} // violates the digits-only PK rule

  it('validates a supplied PK on CREATE (default)', () => {
    expect(validateInstance(codedDef, bad).find(i => i.path === 'id')).toBeDefined()
  })

  it('SKIPS the immutable PK on UPDATE (created: false)', () => {
    // The PK is already persisted + immutable, so a strict PK validator (or a
    // snowflake PK holding a legacy cuid) must not reject it on update.
    expect(validateInstance(codedDef, bad, {created: false}).find(i => i.path === 'id')).toBeUndefined()
    // non-PK fields are still validated on update
    expect(validateInstance(codedDef, {id: bad.id, title: ''}, {created: false}).length).toBeGreaterThan(0)
  })
})

class SnowflakePk extends Model {
  id = id({snowflake: true})
  title = text()
}
new Pylon({db: {models: [SnowflakePk]}})
const snowflakeDef = getModelDefinitionOrThrow(SnowflakePk)

describe('id({snowflake:true}) validates a supplied id on create', () => {
  it('rejects a non-snowflake id (mint a new one instead of carrying a legacy value)', () => {
    expect(validateInstance(snowflakeDef, {id: 'legacy-cuid', title: 'x'}).find(i => i.path === 'id')).toBeDefined()
  })
  it('accepts a well-formed snowflake', () => {
    expect(validateInstance(snowflakeDef, {id: '1780219977399508992', title: 'x'}).find(i => i.path === 'id')).toBeUndefined()
  })
})
