import {describe, expect, it} from 'vitest'
import {
  Model,
  boolean,
  getModelDefinitionOrThrow,
  id,
  model,
  text,
  timestamp
} from '../src/index'

@model({abstract: true})
class Base extends Model {
  id = id()
  createdAt = timestamp({defaultSql: 'now()'})
}

@model()
class Account extends Base {
  email = text({unique: true})
  fullName = text({column: 'full_name'})
  isActive = boolean({default: true})
  $passwordHash = text({nullable: true})
}

describe('model registry', () => {
  const def = getModelDefinitionOrThrow(Account)

  it('derives the table name from the class name', () => {
    expect(def.tableName).toBe('account')
  })

  it('merges columns inherited from an abstract base model', () => {
    const names = def.columns.map(c => c.propertyKey)
    expect(names).toContain('id')
    expect(names).toContain('createdAt')
    expect(names).toContain('email')
  })

  it('resolves the primary key from the abstract base', () => {
    expect(def.primaryKey?.propertyKey).toBe('id')
    expect(def.primaryKey?.autoIncrement).toBe(true)
  })

  it('snake_cases column names and honours overrides', () => {
    expect(def.columns.find(c => c.propertyKey === 'createdAt')?.columnName).toBe(
      'created_at'
    )
    expect(def.columns.find(c => c.propertyKey === 'isActive')?.columnName).toBe(
      'is_active'
    )
    expect(def.columns.find(c => c.propertyKey === 'fullName')?.columnName).toBe(
      'full_name'
    )
  })

  it('marks $-prefixed properties as hidden but keeps them as columns', () => {
    const secret = def.columns.find(c => c.propertyKey === '$passwordHash')
    expect(secret).toBeDefined()
    expect(secret?.hidden).toBe(true)
    expect(secret?.columnName).toBe('password_hash')
  })

  it('assigns a default manager to concrete models', () => {
    expect((Account as any).objects).toBeDefined()
    expect(typeof (Account as any).objects.filter).toBe('function')
  })

  it('keeps instances honest — descriptors are replaced after construction', () => {
    const a = new Account()
    expect(a.email).toBeUndefined()
    expect(a.id).toBeUndefined()
    // Literal defaults are applied to the instance.
    expect(a.isActive).toBe(true)
  })
})
