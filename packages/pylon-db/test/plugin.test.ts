import {afterEach, describe, expect, it} from 'vitest'
import {getDatabase, setDefaultDatabase, useDatabase} from '../src/index'

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
})
