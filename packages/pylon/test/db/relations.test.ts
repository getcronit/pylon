import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  foreignKey,
  getModelDefinitionOrThrow,
  hasMany,
  id,
  text,
  type Relation,
  type RelatedManager
} from '@/db/index'

class Author extends Model {
  id = id()
  name = text()
  books = hasMany(() => Book, {foreignKey: 'authorId'})
}

class Book extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

new Pylon({db: {models: [Author, Book]}})

describe('relations registry', () => {
  const bookDef = getModelDefinitionOrThrow(Book)
  const authorDef = getModelDefinitionOrThrow(Author)

  it('registers the foreign-key scalar as a real column', () => {
    const fk = bookDef.columns.find(c => c.propertyKey === 'authorId')
    expect(fk).toBeDefined()
    expect(fk?.columnName).toBe('author_id')
    expect(fk?.sqlType).toBe('bigint')
  })

  it('records a belongsTo relation with a derived accessor name', () => {
    const rel = bookDef.relations.find(r => r.kind === 'belongsTo')
    expect(rel).toBeDefined()
    expect(rel?.propertyKey).toBe('author') // authorId -> author
    expect(rel?.fkProperty).toBe('authorId')
    expect(rel?.fkColumn).toBe('author_id')
    expect(rel?.target()).toBe(Author)
  })

  it('records a hasMany relation pointing back via the target FK', () => {
    const rel = authorDef.relations.find(r => r.kind === 'hasMany')
    expect(rel).toBeDefined()
    expect(rel?.propertyKey).toBe('books')
    expect(rel?.targetForeignKey).toBe('authorId')
    expect(rel?.target()).toBe(Book)
  })

  it('installs a lazy belongsTo accessor on the prototype', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Book.prototype, 'author')
    expect(descriptor?.get).toBeTypeOf('function')
  })

  it('keeps the FK scalar undefined and relation accessors live on instances', () => {
    const book = new Book()
    expect(book.authorId).toBeUndefined()
    // belongsTo with no FK short-circuits to null.
    expect(book.author).toBeInstanceOf(Promise)

    const author = new Author()
    // hasMany resolves to a RelatedManager (chainable + thenable).
    expect(typeof author.books.filter).toBe('function')
  })
})
