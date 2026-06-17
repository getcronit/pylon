import {afterEach, describe, expect, it, vi} from 'vitest'
import {appGroups, db, getModelDefinitionOrThrow, models} from '../src/index'

const blog = models.app('blog')
const shop = models.app('shop', {dependsOn: ['payments']})

@blog.model()
class Author extends blog.Model {
  static objects = db.manager(Author)
  id = blog.ID()
  name = blog.Text()
}

@blog.model({table: 'legacy_articles'}) // explicit table wins verbatim (no prefix)
class Article extends blog.Model {
  static objects = db.manager(Article)
  id = blog.ID()
  authorId = blog.ForeignKey(() => Author)
}

@shop.model()
class Order extends shop.Model {
  static objects = db.manager(Order)
  id = shop.ID()
  buyerId = shop.ForeignKey(() => Author) // cross-app FK → blog
}

describe('models.app() scoped factory', () => {
  it('tags each model with its app', () => {
    expect(getModelDefinitionOrThrow(Author).app).toBe('blog')
    expect(getModelDefinitionOrThrow(Order).app).toBe('shop')
  })

  it('auto-prefixes the table name with the app (snake_case class)', () => {
    expect(getModelDefinitionOrThrow(Author).tableName).toBe('blog_author')
    expect(getModelDefinitionOrThrow(Order).tableName).toBe('shop_order')
  })

  it('an explicit table overrides the prefix verbatim', () => {
    expect(getModelDefinitionOrThrow(Article).tableName).toBe('legacy_articles')
  })
})

describe('appGroups() derivation', () => {
  const byName = Object.fromEntries(appGroups().map(g => [g.name, g]))

  it('groups registered models by app tag', () => {
    expect(byName.blog.models).toEqual(expect.arrayContaining([Author, Article]))
    expect(byName.shop.models).toEqual([Order])
  })

  it('infers dependencies from cross-app FKs and unions explicit dependsOn', () => {
    expect(byName.blog.dependencies).toEqual([]) // no FK out of blog
    // shop: 'blog' inferred (Order.buyer → Author) + 'payments' explicit
    expect([...byName.shop.dependencies!].sort()).toEqual(['blog', 'payments'])
  })
})

describe('models.app() secure-without-policy guard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns when a secure app gets no policy (e.g. an import cycle left it undefined)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    models.app('sec_no_policy', {secure: true, policy: undefined})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('has no `policy`')
  })

  it('stays silent for a secure app WITH a policy, or a non-secure app', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    models.app('sec_with_policy', {secure: true, policy: () => true})
    models.app('open_app', {})
    expect(warn).not.toHaveBeenCalled()
  })
})
