import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, can, filter, runWithAppContext} from '@/db/index'
import {getModelDefinition} from '@/db/registry'

describe('new Pylon({db: {models}}) — app-bound model config', () => {
  it('a named app prefixes the table + tags the app', () => {
    class Post extends Model {
      static objects = manager(Post)
      id = id()
      title = text()
    }
    new Pylon({name: 'blog', db: {models: [Post]}})

    const def = getModelDefinition(Post)
    expect(def?.app).toBe('blog')
    expect(def?.tableName).toBe('blog_post')
  })

  it('db.secure applies to the app’s models', () => {
    class Product extends Model {
      static objects = manager(Product)
      id = id()
      name = text()
    }
    new Pylon({name: 'shop', db: {models: [Product], secure: true}})

    const def = getModelDefinition(Product)
    expect(def?.app).toBe('shop')
    expect(def?.secure).toBe(true)
    expect(def?.tableName).toBe('shop_product')
  })

  it('a per-model static config.table overrides the app prefix', () => {
    class Entry extends Model {
      static config = {table: 'custom_ledger'}
      static objects = manager(Entry)
      id = id()
    }
    new Pylon({name: 'inv', db: {models: [Entry]}})

    expect(getModelDefinition(Entry)?.tableName).toBe('custom_ledger')
  })

  it('cross-cutting abilities live in db config', async () => {
    class Contact extends Model {
      static objects = manager(Contact)
      id = id()
      ownerId = text()
      name = text()
    }
    new Pylon({
      name: 'crm',
      db: {
        models: [Contact],
        abilities(p, can) {
          can('read', Contact, {ownerId: p?.id})
        }
      }
    })

    // App-level abilities are wired in a microtask (after all models load).
    await new Promise(r => setTimeout(r))

    runWithAppContext({principal: {id: 'u1'}}, () => {
      expect(filter('read', Contact)).toEqual({OR: [{ownerId: 'u1'}]})
      expect(can('read', Object.assign(new Contact(), {ownerId: 'u1'}))).toBe(true)
      expect(can('read', Object.assign(new Contact(), {ownerId: 'u2'}))).toBe(false)
    })
  })

  it('an un-named (root) app keeps bare table names', () => {
    class Orphan extends Model {
      static objects = manager(Orphan)
      id = id()
    }
    new Pylon({db: {models: [Orphan]}})

    expect(getModelDefinition(Orphan)?.tableName).toBe('orphan')
  })
})
