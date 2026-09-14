/**
 * `@inContext` — request context declared in the query document, read by resolvers.
 *
 * The alternative was forwarding the locale as an HTTP header. It is wrong for a caching
 * client: `pylon-query` keys its store on `documentId ~ variablesHash(variables)` and
 * nothing else, so the same document with the same variables IS the same entry — English and
 * German results would collide on one key. Putting the locale in the document makes it part
 * of the cache key by construction. (Shopify's Storefront API uses the same directive name
 * for the same reason.)
 *
 * These assert the property that matters: what the resolver sees is decided by the DOCUMENT,
 * and specifically NOT by request headers.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/in-context-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4797
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

const gql = async (
  body: {query: string; variables?: Record<string, unknown>},
  headers: Record<string, string> = {}
) => {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body)
  })
  return res.json() as Promise<{data?: any; errors?: any[]}>
}

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})

  const build = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 180_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  if (build.status !== 0) {
    throw new Error(`build failed:\n${build.stderr ?? ''}\n${build.stdout ?? ''}`)
  }

  server = spawn('node', ['.pylon/server.mjs'], {
    cwd: appDir,
    env: {...process.env, PORT: String(PORT), PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  server.stdout?.on('data', d => (serverLog += d))
  server.stderr?.on('data', d => (serverLog += d))

  for (let i = 0; i < 80; i++) {
    try {
      await gql({query: '{__typename}'})
      return
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
  throw new Error(`server never came up on ${PORT}. Log:\n${serverLog}`)
}, 240_000)

afterAll(async () => {
  server?.kill('SIGKILL')
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('the directive is part of the schema', () => {
  it('is emitted into schema.graphql', async () => {
    // Without the DEFINITION, a query carrying the directive fails validation before any
    // resolver runs.
    const sdl = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')
    expect(sdl).toContain('directive @inContext(')
    expect(sdl).toMatch(/on QUERY \| MUTATION \| SUBSCRIPTION/)
  })

  it('accepts the directive without a validation error', async () => {
    const res = await gql({query: 'query @inContext(locale: "de") {greeting}'})
    expect(res.errors).toBeUndefined()
  })
})

describe('resolvers read it via getLocale()', () => {
  it('is undefined when the operation states no locale', async () => {
    // `undefined` is meaningful — the caller did not ask, so the resolver decides. It must
    // not be papered over with a default.
    const res = await gql({query: '{greeting localeOrNone}'})
    expect(res.data.localeOrNone).toBe('(none)')
    expect(res.data.greeting).toBe('Hello')
  })

  it('reads an inline literal', async () => {
    const res = await gql({query: 'query @inContext(locale: "de") {greeting localeOrNone}'})
    expect(res.data).toEqual({greeting: 'Hallo', localeOrNone: 'de'})
  })

  it('reads a VARIABLE — the compiled form', async () => {
    // One document serves every locale, so the document id stays stable and the locale
    // lands in the variables hash, which is what keys the client cache.
    const res = await gql({
      query: 'query G($__locale: String) @inContext(locale: $__locale) {greeting}',
      variables: {__locale: 'fr'}
    })
    expect(res.data.greeting).toBe('Bonjour')
  })

  it('serves the same document differently per variable', async () => {
    const q = 'query G($__locale: String) @inContext(locale: $__locale) {greeting}'
    const [de, fr] = await Promise.all([
      gql({query: q, variables: {__locale: 'de'}}),
      gql({query: q, variables: {__locale: 'fr'}})
    ])
    expect(de.data.greeting).toBe('Hallo')
    expect(fr.data.greeting).toBe('Bonjour')
  })
})

describe('headers do not influence it', () => {
  it('ignores Accept-Language', async () => {
    // The whole point: context comes from the document, so it is in the cache key. A header
    // would let two identical cache keys hold different content.
    const res = await gql({query: '{greeting localeOrNone}'}, {'accept-language': 'de-DE,de'})
    expect(res.data).toEqual({greeting: 'Hello', localeOrNone: '(none)'})
  })

  it('ignores a locale cookie', async () => {
    const res = await gql({query: '{localeOrNone}'}, {cookie: 'locale=de'})
    expect(res.data.localeOrNone).toBe('(none)')
  })

  it('lets the document win over a contradicting header', async () => {
    const res = await gql(
      {query: 'query @inContext(locale: "fr") {greeting}'},
      {'accept-language': 'de-DE'}
    )
    expect(res.data.greeting).toBe('Bonjour')
  })
})
