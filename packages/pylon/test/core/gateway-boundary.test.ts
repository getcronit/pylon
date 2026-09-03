import {delegateToSchema} from '@graphql-tools/delegate'
import {
  buildSchema,
  execute,
  GraphQLObjectType,
  OperationTypeNode,
  parse,
  print
} from 'graphql'
import {beforeEach, describe, expect, it} from 'vitest'

import {
  __resetSchemaCache,
  createGateway,
  ForceArgsTransform,
  getRemoteSchema,
  pass,
  passthrough,
  PylonPatchTransform,
  type FieldPolicy
} from '@/core/gateway'

/**
 * The boundary properties of `createGateway`.
 *
 * A patch is a RESULT transform, so on its own it constrains neither the
 * arguments a client sends nor the types a selection can reach. These cover the
 * two mechanisms that close that, and the schema cache's failure path.
 */

const targetSchema = buildSchema(`
  type Product { id: ID!, title: String! }
  type ProductConnection { totalCount: Int!, nodes: [Product!]! }
  type ProductCollection {
    handle: String!
    products(query: String, first: Int): ProductConnection!
  }
  type Vendor {
    name: String!
    products(query: String, first: Int): ProductConnection!
  }
  type Query {
    products(query: String, first: Int): ProductConnection!
    productCollections(first: Int): [ProductCollection!]!
  }
`)

/** `Type.field` → policy, the shape the gateway collects from `pass()`. */
const policies = (entries: Record<string, FieldPolicy>) =>
  new Map(Object.entries(entries))

const run = (
  transform: ForceArgsTransform,
  source: string,
  fieldName = 'productCollections'
) =>
  print(
    transform.transformRequest(
      {document: parse(source), variables: {}},
      {targetSchema, fieldName}
    ).document
  )

describe('ForceArgsTransform', () => {
  const VISIBLE = 'status:ACTIVE published:true'

  it('writes a forced argument onto a NESTED field', () => {
    // The case a patch cannot reach: the constraint lives on the root resolver,
    // so rows walked through the collection would otherwise be unfiltered.
    const out = run(
      new ForceArgsTransform(policies({'ProductCollection.products': {force: {query: VISIBLE}}}), {}),
      `{ productCollections { handle products(first: 10) { totalCount } } }`
    )

    expect(out).toContain(`query: "${VISIBLE}"`)
    expect(out).toContain('first: 10')
  })

  it('OVERRIDES a value the client sent, rather than merging with it', () => {
    // The whole point: a forced argument is a constraint, not a default. A
    // client asking for drafts must not get them.
    const out = run(
      new ForceArgsTransform(policies({'ProductCollection.products': {force: {query: VISIBLE}}}), {}),
      `{ productCollections { products(query: "status:DRAFT") { totalCount } } }`
    )

    expect(out).toContain(`query: "${VISIBLE}"`)
    expect(out).not.toContain('status:DRAFT')
  })

  it('keys on the PARENT TYPE, so a same-named field elsewhere is untouched', () => {
    const out = run(
      new ForceArgsTransform(policies({'ProductCollection.products': {force: {query: VISIBLE}}}), {}),
      `{
        productCollections { products(first: 1) { totalCount } }
        products(query: "anything") { totalCount }
      }`
    )

    // Forced inside the collection...
    expect(out).toMatch(/ProductCollection|handle|first: 1/)
    expect(out).toContain(`query: "${VISIBLE}"`)
    // ...and the root field, which was not configured, keeps its own argument.
    expect(out).toContain('query: "anything"')
  })

  it('resolves a (ctx) => value entry once, against the request context', () => {
    const seen: unknown[] = []
    const out = run(
      new ForceArgsTransform(
        policies({
          'ProductCollection.products': {
            force: {
              query: (ctx: any) => {
                seen.push(ctx)
                return `tenant:${ctx.tenantId}`
              }
            }
          }
        }),
        {tenantId: 't1'}
      ),
      `{ productCollections { products { totalCount } a: products { totalCount } } }`
    )

    expect(out).toContain('query: "tenant:t1"')
    // Resolved per request, not per matching node.
    expect(seen).toHaveLength(1)
  })

  it('is a no-op without configuration', () => {
    const source = `{ productCollections { products(first: 5) { totalCount } } }`
    const original = {document: parse(source), variables: {}}

    const ctx = {targetSchema, fieldName: 'productCollections'}
    expect(new ForceArgsTransform(undefined, {}).transformRequest(original, ctx)).toBe(original)
    expect(new ForceArgsTransform(policies({}), {}).transformRequest(original, ctx)).toBe(original)
  })

  it('skips an entry whose value resolves to undefined', () => {
    const out = run(
      new ForceArgsTransform(
        policies({'ProductCollection.products': {force: {query: () => undefined}}}),
        {}
      ),
      `{ productCollections { products(query: "kept") { totalCount } } }`
    )

    expect(out).toContain('query: "kept"')
  })
})

describe('argument allowlist', () => {
  const ALLOW = {
    'ProductCollection.products': {args: ['first'], force: {query: 'visible'}}
  }

  it('rejects an argument outside the allowlist', () => {
    expect(() =>
      run(
        new ForceArgsTransform(policies(ALLOW), {}),
        `{ productCollections { products(first: 5, after: "cur") { totalCount } } }`
      )
    ).toThrow(/Argument "after" is not allowed on "ProductCollection.products"/)
  })

  it('allows a forced argument even though it is not in args', () => {
    // Forcing implies permission: the caller's value is replaced, not refused.
    const out = run(
      new ForceArgsTransform(policies(ALLOW), {}),
      `{ productCollections { products(first: 5, query: "status:DRAFT") { totalCount } } }`
    )

    expect(out).toContain('query: "visible"')
    expect(out).not.toContain('status:DRAFT')
  })

  it('rejects an argument the REMOTE added later — deny by default', () => {
    // The regression this exists for: the remote grows an argument, and a
    // passed-through field silently gains it.
    expect(() =>
      run(
        new ForceArgsTransform(policies(ALLOW), {}),
        `{ productCollections { products(first: 1, newlyAddedUpstream: true) { totalCount } } }`
      )
    ).toThrow(/GATEWAY_ARGUMENT_NOT_ALLOWED|not allowed/)
  })

  it('carries the allowed set on the error, so the message is actionable', () => {
    try {
      run(
        new ForceArgsTransform(policies(ALLOW), {}),
        `{ productCollections { products(after: "x") { totalCount } } }`
      )
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err.extensions?.code).toBe('GATEWAY_ARGUMENT_NOT_ALLOWED')
      expect(err.extensions?.field).toBe('ProductCollection.products')
      expect(err.extensions?.allowed).toEqual(['first', 'query'])
    }
  })

  it('without `args` nothing is denied — forcing alone stays opt-in', () => {
    const out = run(
      new ForceArgsTransform(
        policies({'ProductCollection.products': {force: {query: 'visible'}}}),
        {}
      ),
      `{ productCollections { products(first: 1, after: "x") { totalCount } } }`
    )

    expect(out).toContain('after: "x"')
  })
})

describe('pass()', () => {
  it('returns the patch unchanged, so the generated schema is untouched', () => {
    const fn = (c: any) => ({handle: c.handle})
    const wrapped = pass(fn, {products: {args: ['first']}})

    expect(wrapped).toBe(fn)
    expect(wrapped({handle: 'audio'} as any, {} as any)).toEqual({handle: 'audio'})
  })

  it('a patch without pass() carries no policy', () => {
    const t = new PylonPatchTransform({Product: (p: any) => p}, {})
    expect(t.transformResult({__typename: 'Product', id: '1'}).id).toBe('1')
  })
})

describe('PylonPatchTransform strict mode', () => {
  const patches = {
    Product: (p: any) => ({__typename: 'Product', id: p.id})
  }

  it('publishes an unpatched type whole when not strict — the default-allow this documents', () => {
    const t = new PylonPatchTransform(patches, {})
    const out = t.transformResult({
      __typename: 'Money',
      amount: 1,
      internalMargin: 0.4
    })

    expect(out.internalMargin).toBe(0.4)
  })

  it('fails on an unpatched type under strict, naming the type', () => {
    const t = new PylonPatchTransform(patches, {}, true)

    expect(() => t.transformResult({__typename: 'Money', amount: 1})).toThrow(
      /no patch for remote type "Money"/
    )
  })

  it('fails on an unpatched type nested inside a patched one', () => {
    // Reachability is what matters — the leak is through a patched parent.
    const t = new PylonPatchTransform(patches, {}, true)

    expect(() =>
      t.transformResult({
        __typename: 'Product',
        id: '1',
        price: {__typename: 'Money', amount: 1}
      })
    ).toThrow(/"Money"/)
  })

  it('accepts a type declared with passthrough()', () => {
    const t = new PylonPatchTransform(
      {...patches, Money: passthrough<any>()},
      {},
      true
    )

    expect(t.transformResult({__typename: 'Money', amount: 1}).amount).toBe(1)
  })

  it('still applies patches under strict', () => {
    const t = new PylonPatchTransform(patches, {}, true)
    const out = t.transformResult({__typename: 'Product', id: '1', secret: 'x'})

    expect(out.id).toBe('1')
  })
})

describe('getRemoteSchema', () => {
  beforeEach(() => __resetSchemaCache())

  it('introspects once and reuses the result', async () => {
    let calls = 0
    // A real in-memory executor, so introspection SUCCEEDS — otherwise the
    // eviction below would (correctly) make the second call re-introspect and
    // this would be testing the wrong thing.
    const make = () => {
      calls++
      return async ({document, variables}: any) =>
        execute({schema: targetSchema, document, variableValues: variables})
    }

    const a = await getRemoteSchema('http://x/graphql', make)
    const b = await getRemoteSchema('http://x/graphql', make)

    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  it('EVICTS a failed introspection, so a later request retries', async () => {
    // The regression this guards: the cache holds the promise, so a rejection
    // left in place is replayed forever and the gateway never recovers from a
    // remote restart.
    let attempts = 0
    const failing = () => {
      attempts++
      return async () => {
        throw new Error('connect ECONNREFUSED')
      }
    }

    await expect(getRemoteSchema('http://down/graphql', failing)).rejects.toThrow(
      /could not introspect the remote schema/
    )
    await expect(getRemoteSchema('http://down/graphql', failing)).rejects.toThrow()

    // Two attempts, not one replayed twice.
    expect(attempts).toBe(2)
  })

  it('names the endpoint and keeps the cause', async () => {
    const cause = new Error('connect ECONNREFUSED ::1:3000')
    await expect(
      getRemoteSchema('http://down/graphql', () => async () => {
        throw cause
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('http://down/graphql'),
      cause
    })
  })
})

describe('forceArgs through a real delegation', () => {
  /**
   * The unit tests above assert on the rewritten document. This one runs an
   * actual `delegateToSchema` round trip and asks the REMOTE what arguments it
   * received — which is the only thing that decides whether rows leak.
   */
  const SDL = `
    type Product { id: ID!, title: String!, status: String! }
    type ProductConnection { totalCount: Int!, nodes: [Product!]! }
    type ProductCollection {
      handle: String!
      products(query: String, first: Int): ProductConnection!
    }
    type Query { productCollections: [ProductCollection!]! }
  `

  let seenQuery: string | undefined

  const makeRemote = () => {
    const schema = buildSchema(SDL)
    const query = schema.getQueryType()!
    query.getFields().productCollections.resolve = () => [{handle: 'audio'}]

    const collection = schema.getType('ProductCollection') as GraphQLObjectType
    collection.getFields().products.resolve = (_p: any, args: any) => {
      seenQuery = args.query
      const all = [
        {id: '1', title: 'Live', status: 'ACTIVE'},
        {id: '2', title: 'Secret draft', status: 'DRAFT'}
      ]
      // Stands in for the remote's own filtering.
      const nodes = args.query?.includes('ACTIVE')
        ? all.filter(p => p.status === 'ACTIVE')
        : args.query?.includes('DRAFT')
          ? all.filter(p => p.status === 'DRAFT')
          : all
      return {totalCount: nodes.length, nodes}
    }
    return schema
  }

  const gatewayFor = (policy?: Map<string, FieldPolicy>) => {
    // The "remote" is delegated to directly — the point is the transform
    // pipeline, and an HTTP executor would only add a stub in the middle.
    const remote = makeRemote()
    const gateway = buildSchema(SDL)
    gateway.getQueryType()!.getFields().productCollections.resolve = (
      _r: any,
      _a: any,
      context: any,
      info: any
    ) =>
      delegateToSchema({
        schema: remote,
        operation: OperationTypeNode.QUERY,
        fieldName: 'productCollections',
        context,
        info,
        transforms: [new ForceArgsTransform(policy, {})]
      })
    return gateway
  }

  beforeEach(() => {
    seenQuery = undefined
  })

  it('a client asking for drafts through a nested field gets the forced filter', async () => {
    const res: any = await execute({
      schema: gatewayFor(
        policies({'ProductCollection.products': {force: {query: 'status:ACTIVE'}}})
      ),
      document: parse(
        `{ productCollections { products(query: "status:DRAFT") { totalCount nodes { title } } } }`
      )
    })

    expect(res.errors).toBeUndefined()
    expect(seenQuery).toBe('status:ACTIVE')
    expect(
      res.data.productCollections[0].products.nodes.map((n: any) => n.title)
    ).toEqual(['Live'])
    expect(JSON.stringify(res.data)).not.toContain('Secret draft')
  })

  it('without forceArgs the same query reaches the remote unconstrained', async () => {
    // The leak, reproduced: this is what the fix is for.
    const res: any = await execute({
      schema: gatewayFor(undefined),
      document: parse(
        `{ productCollections { products(query: "status:DRAFT") { nodes { title } } } }`
      )
    })

    expect(seenQuery).toBe('status:DRAFT')
    expect(JSON.stringify(res.data)).toContain('Secret draft')
  })
})

/**
 * Compile-time gating for #117 (validated by `tsc`, never executed).
 *
 * Fields fetched through `needs` are readable on the result. Before this they
 * were fetched but invisible, so every guard had to re-state the selection in an
 * unchecked `as unknown as` cast — and a `needs` entry removed later still
 * compiled, silently disabling the check.
 */
interface FakeRegistry {
  delegate: {
    'Query.product': {
      args: {handle: string}
      return: {
        __typename: 'Product'
        id: string
        title: string
        status: string
        isPublished: boolean
      } | null
    }
  }
  types: {
    Product: {
      __typename: 'Product'
      id: string
      title: string
      status: string
      isPublished: boolean
    }
  }
}

const typedGateway = createGateway<FakeRegistry>().configure({
  url: 'http://example.invalid/graphql',
  patches: {
    // `status` and `isPublished` are deliberately NOT exposed.
    Product: p => ({__typename: 'Product' as const, id: p.id, title: p.title})
  }
})

;async () => {
  const p = await typedGateway.delegate('Query.product', {
    args: {handle: 'x'},
    needs: {status: true, isPublished: true},
    // Typed from `needs`, so the decision is checked against what was fetched.
    guard: r => r.status === 'ACTIVE' && r.isPublished
  })

  // The RETURN type is untouched — only the guard sees the needs fields. That
  // is deliberate: intersecting them into the return mints a structurally new
  // type and the schema builder rejects the duplicate.
  p?.title satisfies string | undefined

  // @ts-expect-error — `status` was fetched for the guard, not exposed
  p?.status
}

;async () => {
  await typedGateway.delegate('Query.product', {
    args: {handle: 'x'},
    needs: {status: true},
    // @ts-expect-error — `isPublished` was not selected by `needs`
    guard: r => r.isPublished === true
  })
}
