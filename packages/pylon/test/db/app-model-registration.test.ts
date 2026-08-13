/**
 * Decorator-free model registration: `app.model(Post, Comment)` (DD §6 Proxy path).
 *
 * Exercises the REAL pylon-db stack — `models.*` field builders, the global registry,
 * `toIR()` — through the new `Pylon.prototype.model` seam (installed via the extension
 * bus). Models are PLAIN classes: no `@model` decorator, no `models.app(...)`, nothing
 * imported from the app. The app pulls them in and registers them, Hono-style.
 */
import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {models, db, toIR, getModelDefinition, getModelDefinitionOrThrow, appGroups} from '../src/index'
import {modelsOf} from '../src/app'
import {hydrate} from '../src/manager'
import type {Relation} from '../src/index'

// Plain models — would normally live in models.ts, importing only pylon-db.
class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text({min: 2})
  books = models.HasMany(() => Book, {foreignKey: 'authorId'})
}
class Book extends models.Model {
  static objects = db.manager(Book)
  id = models.ID()
  title = models.Text()
  authorId = models.ForeignKey(() => Author)
  declare author: Relation<Author>
}

// The app owns the wiring (would be index.ts): models declared in the constructor.
const blog = new Pylon({name: 'blog', db: {models: [Author, Book]}})

describe('new Pylon({models}) — decorator-free registration', () => {
  it('records the models privately (read via modelsOf, no public app.models)', () => {
    expect(modelsOf(blog)).toEqual([Author, Book])
  })

  it('tags each model to the app + prefixes the table (Django-style, composition-safe)', () => {
    expect(getModelDefinitionOrThrow(Author).tableName).toBe('blog_author')
    expect(getModelDefinitionOrThrow(Book).tableName).toBe('blog_book')
    expect(getModelDefinitionOrThrow(Author).app).toBe('blog')
  })

  it('harvests columns + relations from `id = id()` initializers (no decorator)', () => {
    const author = getModelDefinitionOrThrow(Author)
    const book = getModelDefinitionOrThrow(Book)
    expect(author.columns.map(c => c.propertyKey).sort()).toEqual(['id', 'name'])
    // belongsTo registers BOTH the FK scalar column and the `author` accessor relation.
    expect(book.columns.map(c => c.propertyKey).sort()).toEqual(['authorId', 'id', 'title'])
    expect(book.relations.find(r => r.propertyKey === 'author')?.kind).toBe('belongsTo')
    expect(author.relations.find(r => r.propertyKey === 'books')?.kind).toBe('hasMany')
    // FK column name is snake_cased.
    expect(book.columns.find(c => c.propertyKey === 'authorId')?.columnName).toBe('author_id')
  })

  it('`id = id()` works on instances: reads return values, not builders; clean serialization', () => {
    const a: any = new Author()
    expect(a.id).toBeUndefined()
    a.name = 'Ada'
    expect(a.name).toBe('Ada')
    a.name = undefined // "not provided" → no-op
    expect(a.name).toBe('Ada')
    expect(Object.keys(a).sort()).toEqual(['id', 'name'])
    expect({...a}).toMatchObject({name: 'Ada'})
    expect(Object.getOwnPropertySymbols(a)).toHaveLength(0) // store never leaks
  })

  it('contributes both entities to the IR (keyed by entity name, app-prefixed table)', () => {
    const ir = toIR()
    expect(Object.keys(ir.entities)).toEqual(expect.arrayContaining(['Author', 'Book']))
    expect(ir.entities.Author.table).toBe('blog_author')
    expect(ir.entities.Book.table).toBe('blog_book')
  })
})

describe('cross-bundle lookup — duplicate class copies resolve by name', () => {
  // The framework can split a project into several esbuild graphs (server bundle +
  // runtime-config bundle hosting auth middleware). Each inlines its OWN copy of a model
  // class, but pylon-db is external so the registry is shared and keyed by class IDENTITY.
  // Only the graph that CONSTRUCTS the app registers its copy; a copy from another graph
  // (e.g. the one a config-bundle middleware queries) misses on identity. It must still
  // resolve — by name — to the real definition, the way the old class-def-time decorator
  // registered every graph's copy for free.
  it('an unregistered duplicate copy (esbuild `_Author` name) resolves to the real def', () => {
    // A DISTINCT class object that was never registered, carrying esbuild's un-normalized
    // self-reference name `_Author`.
    const AuthorCopy = class extends models.Model {
      id = models.ID()
      name = models.Text({min: 2})
    }
    Object.defineProperty(AuthorCopy, 'name', {value: '_Author', configurable: true})

    expect(AuthorCopy).not.toBe(Author) // genuinely a different class object
    const def = getModelDefinitionOrThrow(AuthorCopy)
    expect(def).toBe(getModelDefinitionOrThrow(Author)) // the REAL, app-bound definition
    expect(def.tableName).toBe('blog_author')
    expect(getModelDefinition(AuthorCopy)).toBe(def) // aliased → later lookups are direct hits
  })

  it('still throws when no same-named model is registered (a real "forgot to register")', () => {
    const Ghost = class extends models.Model {
      id = models.ID()
    }
    Object.defineProperty(Ghost, 'name', {value: 'Ghost', configurable: true})
    expect(() => getModelDefinitionOrThrow(Ghost)).toThrow(/No model definition for "Ghost"/)
  })

  it('hydrates a duplicate copy via the FINALIZED class — populated, not a blank `_Author {}`', () => {
    // The duplicate copy is unfinalized: `new copy()` has no field-storage accessors, so
    // assignments vanish and you get an empty instance. `hydrate` must build `def.ctor`
    // (the registered, finalized class) instead — the bug behind a fetched-then-empty row.
    const AuthorCopy = class extends models.Model {
      id = models.ID()
      name = models.Text({min: 2})
    }
    Object.defineProperty(AuthorCopy, 'name', {value: '_Author', configurable: true})

    const inst: any = hydrate(AuthorCopy as any, {id: 'a1', name: 'Ada'})
    expect(inst).toBeInstanceOf(Author) // the REGISTERED class, not the blank copy
    expect(inst.id).toBe('a1')
    expect(inst.name).toBe('Ada') // values actually landed (would be undefined on a copy)
  })
})

describe("an app's migrations directory (colocated with its source)", () => {
  it('appGroups carries the app-declared `migrations` dir', () => {
    class MigDirWidget extends models.Model {
      static objects = db.manager(MigDirWidget)
      id = models.ID()
    }
    new Pylon({name: 'migdir', db: {models: [MigDirWidget], migrations: 'src/apps/migdir/migrations'}})
    const group = appGroups().find(g => g.name === 'migdir')
    expect(group?.dir).toBe('src/apps/migdir/migrations')
  })

  it('a named app without `migrations` defaults its dir to <source-dir>/migrations', () => {
    class NoDirWidget extends models.Model {
      static objects = db.manager(NoDirWidget)
      id = models.ID()
    }
    // No `migrations` declared → zero-config default from the construction call site
    // (core captures `app.sourceDir`; here that's this test file's directory).
    new Pylon({name: 'nodir', db: {models: [NoDirWidget]}})
    expect(appGroups().find(g => g.name === 'nodir')?.dir).toMatch(/[/\\]migrations$/)
  })
})
