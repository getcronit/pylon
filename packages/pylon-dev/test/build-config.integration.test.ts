/**
 * Config loading: `buildConfigFile` produces `.pylon/config.js` from a standalone
 * `pylon.config.ts` (default OR named export), and crucially does NOT read the
 * entry — the inline `config` export is no longer supported.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {buildConfigFile} from '../src/builder/bundler/build-config'

let dir: string
const outFile = () => path.join(dir, '.pylon', 'config.js')
const loadConfig = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(outFile()).href + `?t=${dir}`)).config

describe('buildConfigFile — standalone pylon.config.ts', () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-cfg-'))
    await fs.mkdir(path.join(dir, 'src'), {recursive: true})
  })
  afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true})
  })

  it('loads a default export', async () => {
    await fs.writeFile(
      path.join(dir, 'pylon.config.ts'),
      'export default { graphiql: false, landingPage: true }'
    )
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toMatchObject({graphiql: false, landingPage: true})
  })

  it('loads a named `config` export', async () => {
    await fs.writeFile(
      path.join(dir, 'pylon.config.ts'),
      'export const config = { graphiql: true }'
    )
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toMatchObject({graphiql: true})
  })

  it('resolves a factory (defineConfig(() => …))', async () => {
    await fs.writeFile(
      path.join(dir, 'pylon.config.ts'),
      'export default () => ({ graphiql: false, landingPage: true })'
    )
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toMatchObject({graphiql: false, landingPage: true})
  })

  it('resolves an async factory', async () => {
    await fs.writeFile(
      path.join(dir, 'pylon.config.ts'),
      'export default async () => ({ graphiql: true })'
    )
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toMatchObject({graphiql: true})
  })

  it('writes an empty config when no pylon.config.ts exists', async () => {
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toEqual({})
  })

  it('ignores an inline `config` export in the entry (no longer supported)', async () => {
    // Entry exports a config — but with no pylon.config.ts, it must NOT be used.
    await fs.writeFile(
      path.join(dir, 'src', 'index.ts'),
      'export const config = { graphiql: true }\nexport const graphql = { Query: {} }'
    )
    await buildConfigFile(dir, outFile())
    expect(await loadConfig()).toEqual({}) // entry's config is not consulted
  })
})
