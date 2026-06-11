import {describe, expect, it} from 'vitest'
import type {PhysicalSchema} from '@getcronit/pylon-ir'
import {generateModelSource} from '../src/codegen'

const col = (over: {name: string; sqlType: any} & Record<string, unknown>) => ({
  primaryKey: false,
  autoIncrement: false,
  unique: false,
  nullable: false,
  property: over.name,
  ...over
})

const schema: PhysicalSchema = {
  author: {
    name: 'author',
    table: 'author',
    columns: [
      col({name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true}),
      col({name: 'email', sqlType: 'text', unique: true}),
      col({name: 'bio', sqlType: 'text', nullable: true}),
      col({name: 'tags', sqlType: 'text', array: true})
    ],
    foreignKeys: [],
    indexes: []
  },
  book: {
    name: 'book',
    table: 'book',
    columns: [
      col({name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true}),
      col({name: 'title', sqlType: 'varchar', length: 120}),
      col({name: 'author_id', sqlType: 'bigint', nullable: true})
    ],
    foreignKeys: [
      {table: 'book', name: 'book_author_id_fkey', column: 'author_id', refTable: 'author', refColumn: 'id', onDelete: 'cascade'}
    ],
    indexes: []
  }
}

describe('generateModelSource', () => {
  const out = generateModelSource(schema)

  it('emits a class per table with @model(table) + manager', () => {
    expect(out).toMatch(/@model\(\{table: "author"\}\)/)
    expect(out).toMatch(/export class Author extends Model/)
    expect(out).toMatch(/static objects = manager\(Author\)/)
    expect(out).toMatch(/export class Book extends Model/)
  })

  it('maps an auto-increment bigint PK to id()', () => {
    expect(out).toMatch(/id = id\(\)/)
  })

  it('maps scalar columns with their options', () => {
    expect(out).toMatch(/email = text\(\{unique: true\}\)/)
    expect(out).toMatch(/bio = text\(\{nullable: true\}\)/)
    expect(out).toMatch(/title = varchar\(120\)/)
  })

  it('maps array columns to array(element)', () => {
    expect(out).toMatch(/tags = array\(text\(\)\)/)
  })

  it('maps FK columns to foreignKey(() => Target) with onDelete', () => {
    expect(out).toMatch(/authorId = foreignKey\(\(\) => Author, \{nullable: true, onDelete: "cascade"\}\)/)
  })

  it('imports exactly the builders it uses', () => {
    const importLine = out.split('\n').find(l => l.startsWith('import'))!
    expect(importLine).toContain('Model')
    expect(importLine).toContain('foreignKey')
    expect(importLine).toContain('array')
    expect(importLine).not.toContain('numeric') // unused
  })
})
