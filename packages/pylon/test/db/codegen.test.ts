import {describe, expect, it} from 'vitest'
import type {PhysicalSchema} from '@getcronit/pylon/ir'
import {generateModelSource} from '@/db/codegen'

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

  it('disambiguates colliding class names (real table vs `_`-join table)', () => {
    // `ProductNotice` and the Prisma implicit join `_ProductNotice` both pascal
    // to `ProductNotice`; the real table keeps the clean name, the join is suffixed.
    const collide: PhysicalSchema = {
      ProductNotice: {
        name: 'ProductNotice',
        table: 'ProductNotice',
        columns: [col({name: 'id', sqlType: 'text', primaryKey: true})],
        foreignKeys: [],
        indexes: []
      },
      _ProductNotice: {
        name: '_ProductNotice',
        table: '_ProductNotice',
        columns: [
          col({name: 'A', sqlType: 'text'}),
          col({name: 'B', sqlType: 'text'})
        ],
        foreignKeys: [
          {table: '_ProductNotice', name: 'fk_a', column: 'A', refTable: 'ProductNotice', refColumn: 'id', onDelete: 'cascade'}
        ],
        indexes: []
      }
    }
    const src = generateModelSource(collide)
    const classNames = [...src.matchAll(/export class (\w+) extends/g)].map(m => m[1])
    expect(new Set(classNames).size).toBe(classNames.length) // all unique
    expect(classNames).toContain('ProductNotice') // real table keeps clean name
    expect(classNames).toContain('ProductNotice2') // join table disambiguated
    // the join's FK still targets the real model's class
    expect(src).toMatch(/A = foreignKey\(\(\) => ProductNotice[,)]/)
  })

  it('detects an implicit m2m join table: omits it + injects manyToMany on both sides', () => {
    const m2m: PhysicalSchema = {
      Product: {
        name: 'Product',
        table: 'Product',
        columns: [col({name: 'id', sqlType: 'text', primaryKey: true})],
        foreignKeys: [],
        indexes: []
      },
      ProductCollection: {
        name: 'ProductCollection',
        table: 'ProductCollection',
        columns: [col({name: 'id', sqlType: 'text', primaryKey: true})],
        foreignKeys: [],
        indexes: []
      },
      // Prisma implicit join table: 2 FK columns, no own PK.
      _ProductToProductCollection: {
        name: '_ProductToProductCollection',
        table: '_ProductToProductCollection',
        columns: [col({name: 'A', sqlType: 'text'}), col({name: 'B', sqlType: 'text'})],
        foreignKeys: [
          {table: '_ProductToProductCollection', name: 'fkA', column: 'A', refTable: 'Product', refColumn: 'id', onDelete: 'cascade'},
          {table: '_ProductToProductCollection', name: 'fkB', column: 'B', refTable: 'ProductCollection', refColumn: 'id', onDelete: 'cascade'}
        ],
        indexes: [{name: 'uq', table: '_ProductToProductCollection', columns: ['A', 'B'], unique: true}]
      }
    }
    const src = generateModelSource(m2m)
    // the join table is NOT emitted as a model
    expect(src).not.toMatch(/class ProductToProductCollection\b/)
    expect(src).not.toMatch(/export class \w*ProductToProductCollection/)
    // both endpoints get a manyToMany bound to the real join table + columns
    expect(src).toMatch(
      /productCollections = manyToMany\(\(\) => ProductCollection, \{through: "_ProductToProductCollection", sourceColumn: "A", targetColumn: "B"\}\)/
    )
    expect(src).toMatch(
      /products = manyToMany\(\(\) => Product, \{through: "_ProductToProductCollection", sourceColumn: "B", targetColumn: "A"\}\)/
    )
    expect(src).toMatch(/import \{[^}]*manyToMany/)
  })

  it('imports exactly the builders it uses', () => {
    const importLine = out.split('\n').find(l => l.startsWith('import'))!
    expect(importLine).toContain('Model')
    expect(importLine).toContain('foreignKey')
    expect(importLine).toContain('array')
    expect(importLine).not.toContain('numeric') // unused
  })
})
