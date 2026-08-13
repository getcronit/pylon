import {GraphQLError} from 'graphql'
import {afterEach, describe, expect, it} from 'vitest'
import {PRINCIPAL_KEY} from '@getcronit/pylon-auth/contract'
import {
  currentPrincipal,
  currentTenant,
  getDatabase,
  NotFoundError,
  setDefaultDatabase,
  useDatabase,
  ValidationError
} from '../src/index'

// A minimal stand-in for the Hono/Pylon request context: a backing Map behind
// `get`/`set`, matching the real `c.get(PRINCIPAL_KEY)` the migrated middleware
// reads to derive the tenant/principal binding. `vars` seeds the initial values.
function mockContext(vars: Record<symbol | string, unknown> = {}) {
  const store = new Map<symbol | string, unknown>(Object.getOwnPropertySymbols(vars).map(s => [s, vars[s as never]]))
  for (const k of Object.keys(vars)) store.set(k, vars[k])
  return {
    get: (key: symbol | string) => store.get(key),
    set: (key: symbol | string, value: unknown) => store.set(key, value)
  }
}

// Build the shape envelop hands onExecuteDone: a result with GraphQL errors and
// a setResult spy. A resolver-thrown error is wrapped by graphql-js so the
// original lives on `.originalError`.
function runOnExecuteDone(
  plugin: ReturnType<typeof useDatabase>,
  errors: GraphQLError[]
): {errors?: readonly GraphQLError[]} | undefined {
  const hooks = plugin.onExecute?.()
  if (!hooks) return undefined
  let next: {errors?: readonly GraphQLError[]} | undefined
  hooks.onExecuteDone({
    result: {errors},
    setResult: r => {
      next = r as typeof next
    }
  })
  return next
}

const validationErr = () =>
  new GraphQLError('val_widget: invalid', {
    path: ['createAuthor'],
    originalError: new ValidationError([{path: 'name', code: 'length', message: 'too short', params: {min: 2}}])
  })

// No real connection is made — `new Pool` is lazy until the first query — so this
// validates the plugin's wiring (connect-on-setup + ambient binding) without a DB.
describe('useDatabase() plugin', () => {
  afterEach(async () => {
    try {
      await getDatabase().destroy()
    } catch {
      /* no default set */
    }
    setDefaultDatabase(undefined)
  })

  it('setup() connects (sets the default database)', () => {
    setDefaultDatabase(undefined)
    useDatabase({connectionString: 'postgres://u:p@localhost:5999/none'}).setup()
    expect(getDatabase()).toBeDefined()
  })

  it('middleware binds the connection as the ambient db for the request', async () => {
    const plugin = useDatabase({connectionString: 'postgres://u:p@localhost:5999/none'})
    plugin.setup()
    const bound = getDatabase()

    let seen: unknown
    await plugin.middleware(mockContext(), async () => {
      seen = getDatabase()
    })
    expect(seen).toBe(bound)
  })

  it('defaults the bound tenant/principal off the identity Principal (PRINCIPAL_KEY)', async () => {
    const plugin = useDatabase({connectionString: 'postgres://u:p@localhost:5999/none'})
    plugin.setup()

    const principal = {id: 'u1', tenant: 'org-42'}
    let seenTenant: unknown
    let seenPrincipal: unknown
    await plugin.middleware(mockContext({[PRINCIPAL_KEY]: principal}), async () => {
      seenTenant = currentTenant()
      seenPrincipal = currentPrincipal()
    })
    // useIdentity binds the Principal at PRINCIPAL_KEY; bare useDatabase() derives
    // the ambient tenant + principal from it — no per-app wiring boilerplate.
    expect(seenTenant).toBe('org-42')
    expect(seenPrincipal).toBe(principal)
  })

  it('explicit tenant/principal options override the identity-derived defaults', async () => {
    const plugin = useDatabase({
      connectionString: 'postgres://u:p@localhost:5999/none',
      tenant: () => 'org-explicit',
      principal: () => ({id: 'custom'})
    })
    plugin.setup()

    let seenTenant: unknown
    let seenPrincipal: unknown
    await plugin.middleware(mockContext({[PRINCIPAL_KEY]: {id: 'u1', tenant: 'org-42'}}), async () => {
      seenTenant = currentTenant()
      seenPrincipal = currentPrincipal()
    })
    expect(seenTenant).toBe('org-explicit')
    expect(seenPrincipal).toEqual({id: 'custom'})
  })

  it('default mapper rewrites a thrown ValidationError as a BAD_USER_INPUT GraphQLError', () => {
    const plugin = useDatabase()
    const next = runOnExecuteDone(plugin, [validationErr()])
    const err = next?.errors?.[0]
    expect(err).toBeInstanceOf(GraphQLError)
    expect(err?.message).toBe('Validation failed')
    expect(err?.extensions.code).toBe('BAD_USER_INPUT')
    expect(err?.extensions.issues).toEqual([
      {path: 'name', code: 'length', message: 'too short', params: {min: 2}}
    ])
    // path is preserved so clients can locate the failing field operation
    expect(err?.path).toEqual(['createAuthor'])
  })

  it('a custom mapper controls the message + extensions (e.g. for localization)', () => {
    const plugin = useDatabase({
      validationErrors: issues => ({message: 'nope', extensions: {code: 'INVALID', count: issues.length}})
    })
    const err = runOnExecuteDone(plugin, [validationErr()])?.errors?.[0]
    expect(err?.message).toBe('nope')
    expect(err?.extensions).toEqual({code: 'INVALID', count: 1})
  })

  it('validationErrors: false leaves the error untouched (stays masked)', () => {
    const plugin = useDatabase({validationErrors: false})
    // no onExecuteDone work to do → setResult is never called
    expect(runOnExecuteDone(plugin, [validationErr()])).toBeUndefined()
  })

  it('passes non-validation errors through unchanged', () => {
    const plugin = useDatabase()
    const other = new GraphQLError('boom', {originalError: new Error('db down')})
    // nothing matched → setResult not called
    expect(runOnExecuteDone(plugin, [other])).toBeUndefined()
  })

  it('maps a NotFoundError (.get() miss) to a NOT_FOUND GraphQLError', () => {
    const plugin = useDatabase()
    const err = new GraphQLError('User not found', {
      path: ['user'],
      originalError: new NotFoundError('user', {id: '123'})
    })
    const next = runOnExecuteDone(plugin, [err])
    expect(next?.errors?.[0].extensions).toMatchObject({code: 'NOT_FOUND', entity: 'user'})
  })
})
