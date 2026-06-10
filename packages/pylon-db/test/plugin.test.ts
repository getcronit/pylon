import {GraphQLError} from 'graphql'
import {afterEach, describe, expect, it} from 'vitest'
import {getDatabase, setDefaultDatabase, useDatabase, ValidationError} from '../src/index'

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
    await plugin.middleware({}, async () => {
      seen = getDatabase()
    })
    expect(seen).toBe(bound)
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
})
