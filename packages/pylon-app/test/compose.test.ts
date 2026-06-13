import {describe, expect, it} from 'vitest'
import {compose, defineApp, ForbiddenError, useApp} from '../src/index'

describe('compose()', () => {
  it('merges resolver fragments across apps into one graphql object', () => {
    const a = defineApp('alpha').resolvers({
      Query: {a: () => 1},
      Mutation: {doA: () => true}
    })
    const b = defineApp('beta').resolvers({
      Query: {b: () => 2}
    })

    const {graphql, apps} = compose(a, b)
    expect(Object.keys(graphql.Query!).sort()).toEqual(['a', 'b'])
    expect(Object.keys(graphql.Mutation!)).toEqual(['doA'])
    expect(graphql.Query!.a()).toBe(1)
    expect(graphql.Query!.b()).toBe(2)
    expect(apps).toHaveLength(2)
  })

  it('gate-wraps each app: a denying authorize makes its resolvers throw ForbiddenError', () => {
    // No principal is bound (unit context) → `p => !!p` denies.
    const secured = defineApp('locked', {authorize: p => !!p}).resolvers({
      Query: {secret: () => 'shh'}
    })
    const open = defineApp('open').resolvers({Query: {hello: () => 'hi'}})

    const {graphql} = compose(secured, open)
    expect(() => graphql.Query!.secret()).toThrow(ForbiddenError)
    expect(graphql.Query!.hello()).toBe('hi') // ungated app unaffected
  })
})

describe('useApp()', () => {
  it('returns plugins in order: identity → database → routes', () => {
    const app = defineApp('svc').resolvers({Query: {ping: () => 'pong'}})
    const plugins = useApp(compose(app), {identity: () => undefined})
    expect(plugins).toHaveLength(3)
    expect(typeof plugins[0].middleware).toBe('function') // useIdentity
    expect(typeof plugins[1].middleware).toBe('function') // useDatabase
    expect(typeof plugins[2].setup).toBe('function') // routes
  })

  it('omits the identity plugin when no provider is given', () => {
    const app = defineApp('svc2').resolvers({Query: {ping: () => 'pong'}})
    const plugins = useApp(compose(app))
    expect(plugins).toHaveLength(2) // database + routes
  })

  it('gate-wraps mounted routes: a denied request gets 403 before the handler runs', async () => {
    let handlerRan = false
    const app = defineApp('rest', {authorize: p => !!p}).routes((r: any) => {
      r.get('/rest/ping', (c: any) => {
        handlerRan = true
        return c.text('pong')
      })
    })

    // Fake Hono app: capture the (wrapped) handler registered by the gated router.
    let registered: ((c: any) => any) | undefined
    const fakeApp = {
      get: (_path: string, handler: (c: any) => any) => {
        registered = handler
      }
    }
    const routesPlugin = useApp(compose(app))[1] // [database, routes]
    routesPlugin.setup!(fakeApp as any)

    // Fake context — no principal bound → authorize denies.
    const c = {
      json: (body: any, status: number) => ({body, status}),
      text: (t: string) => ({body: t, status: 200})
    }
    const res = await registered!(c)
    expect(res).toEqual({body: {error: 'Forbidden'}, status: 403})
    expect(handlerRan).toBe(false)
  })
})
