/**
 * Proves the registration-discovery guarantee end-to-end: a `@model()` class in a
 * file the entry NEVER imports (`src/orphan.ts`) must still land in the built schema.
 * Without discovery it would be silently dropped (the classic "db push made no
 * tables" footgun). Runs the shipped CLI on a real fixture and parses the SDL.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, type GraphQLSchema} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon-dev/dist/index.js')
const appDir = path.resolve(dir, '../fixtures/discover-orphan-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let schema: GraphQLSchema | undefined

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Build pylon-dev first.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})
  buildResult = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  if (buildResult.status === 0) {
    const sdl = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')
    schema = buildSchema(sdl)
  }
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('registration discovery (pylon build)', () => {
  it('builds successfully', () => {
    expect(buildResult.status, buildResult.stderr).toBe(0)
  })

  it('includes the entry model (sanity)', () => {
    expect(schema?.getType('Gadget')).toBeDefined()
  })

  it('includes the ORPHAN model that no import reaches', () => {
    // The whole point: `Widget` lives in src/orphan.ts, imported by nothing.
    expect(schema?.getType('Widget')).toBeDefined()
  })
})
