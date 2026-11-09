/**
 * Regression e2e for the build-time `serve()` footgun: a real Node Pylon app
 * with ORM models AND a top-level `serve(app)`. The build must:
 *   - complete (NOT hang on a started server), and
 *   - still merge the ORM models into the schema.
 *
 * Before side-effect stripping, `pylon build` executed this entry to read the
 * models — starting the server and hanging the build. The spawn has a timeout,
 * so a regression shows up as a non-zero/﻿null exit rather than a wedged run.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, GraphQLObjectType, GraphQLSchema} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.resolve(dir, '../../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/serve-app')
const pylonDir = path.join(appDir, '.pylon')

let buildResult: ReturnType<typeof spawnSync>
let schema: GraphQLSchema

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})
  buildResult = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    // Generous cap: a real hang (started server) still gets killed → status null →
    // the assertion fails. The wide bound only tolerates a slow build when the full
    // suite runs many heavy build-spawns in parallel (isolated this build is ~2s).
    timeout: 120_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  if (buildResult.status === 0) {
    schema = buildSchema(await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8'))
  }
}, 180_000)

afterAll(async () => {
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('pylon build on an app with top-level serve(app)', () => {
  it('completes without hanging on the started server', () => {
    // A hang would surface as status null (timeout); a started server would
    // also typically prevent a clean exit.
    expect(buildResult.status, String(buildResult.stderr ?? buildResult.stdout ?? "")).toBe(0)
  })

  it('still merges the ORM models into the schema', () => {
    const widget = schema.getType('Widget') as GraphQLObjectType
    expect(widget).toBeInstanceOf(GraphQLObjectType)
    expect(String(widget.getFields().id.type)).toBe('ID!') // ORM intent
    expect(String(widget.getFields().name.type)).toBe('String!')
    expect(String((schema.getType('Query') as GraphQLObjectType).getFields().widgets.type)).toBe(
      '[Widget!]!'
    )
  })
})
