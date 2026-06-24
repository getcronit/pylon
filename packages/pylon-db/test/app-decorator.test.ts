import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
// Importing the package entry (which you do to extend `Model`) enables `app.model()`.
// No separate `@getcronit/pylon-db/app` import.
import {Model, manager, id, text} from '../src/index'
import {getModelDefinition} from '../src/registry'

describe('app.model() — bind a model to its Pylon instance', () => {
  it('importing @getcronit/pylon-db is enough to enable app.model()', () => {
    const blog = new Pylon({name: 'blog'})

    @blog.model()
    class Post extends Model {
      static objects = manager(Post)
      id = id()
      title = text()
    }

    const def = getModelDefinition(Post)
    expect(def?.app).toBe('blog')
    expect(def?.tableName).toBe('blog_post')
  })

  it('ORM config is injectable in the constructor: new Pylon({name, models})', () => {
    const shop = new Pylon({name: 'shop', models: {secure: true}})

    @shop.model()
    class Product extends Model {
      static objects = manager(Product)
      id = id()
      name = text()
    }

    const def = getModelDefinition(Product)
    expect(def?.app).toBe('shop')
    expect(def?.secure).toBe(true)
    expect(def?.tableName).toBe('shop_product')
  })

  it('app.models() overrides constructor config and is chainable', () => {
    const acct = new Pylon({name: 'acct', models: {secure: false}}).models({secure: true})

    @acct.model()
    class Ledger extends Model {
      static objects = manager(Ledger)
      id = id()
    }

    expect(getModelDefinition(Ledger)?.secure).toBe(true) // the .models() override wins
  })

  it('a per-model option still overrides the app default', () => {
    const inv = new Pylon({name: 'inv'})

    @inv.model({table: 'custom_ledger'})
    class Entry extends Model {
      static objects = manager(Entry)
      id = id()
    }

    expect(getModelDefinition(Entry)?.tableName).toBe('custom_ledger')
  })

  it('throws a clear error when the app has no name', () => {
    const anon = new Pylon()
    expect(() => {
      @anon.model()
      class Orphan extends Model {
        static objects = manager(Orphan)
        id = id()
      }
      void Orphan
    }).toThrow(/needs the Pylon to have a `name`/)
  })
})
