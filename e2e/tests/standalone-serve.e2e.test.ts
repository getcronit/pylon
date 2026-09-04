/**
 * Standalone deploy e2e (Workstream D).
 *
 * `pylon build --standalone` traces the runtime file graph into `.pylon/standalone/` — a
 * self-contained artifact (app + only the node_modules it touches). This proves the
 * artifact actually RUNS with no install, in TRUE isolation: the standalone dir is copied
 * OUT of the monorepo (into the OS temp dir) so it cannot fall back on the workspace's
 * node_modules.
 *
 * It boots the entry `server.mjs` DIRECTLY (NOT the launcher, which chdir's) with
 * `cwd: os.tmpdir()` (≠ the app dir) — so serving at all is the cwd-INDEPENDENCE guard for the
 * FRAMEWORK: the usePages runtime must resolve its artifacts from the entry's own location
 * (globalThis.__PYLON_ROOT__, set by server.mjs) rather than process.cwd(). Asserts SSR +
 * GraphQL respond — SSR also requires react/react-dom (reached only via the usePages SSR route
 * chunks, nft's blind spot) to have been traced in.
 *
 * No DB / docker (in-memory posts fixture).
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/paginated-pages-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4795
const base = `http://localhost:${PORT}`

let server: ChildProcess | undefined
let tmpDir = ''
const log: string[] = []

async function waitForReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`standalone server did not become ready\n${log.slice(-30).join('')}`)
}

describe('pylon build --standalone (isolated deploy)', () => {
  let html = ''

  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    await fs.rm(pylonDir, {recursive: true, force: true})

    const build = spawnSync('node', [cliBin, 'build', '--standalone'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 150_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    if (build.status !== 0) {
      throw new Error(`standalone build failed: ${String(build.stderr ?? build.stdout ?? '')}`)
    }

    // Copy the artifact OUT of the monorepo so module resolution can't reach the workspace
    // node_modules — the only honest test of "self-contained". Symlinks are preserved
    // (verbatim) so the pnpm layout stays intact.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-standalone-'))
    await fs.cp(path.join(pylonDir, 'standalone'), tmpDir, {
      recursive: true,
      verbatimSymlinks: true
    })

    // The launcher is the user-facing convenience (chdir + import); assert it was written.
    expect(existsSync(path.join(tmpDir, 'start.mjs')), 'launcher should exist').toBe(true)

    // Boot the ENTRY directly (not the launcher) from an UNRELATED cwd — the framework must
    // anchor to the entry location, not cwd. appDir's base-relative path inside the copy
    // mirrors the trace base (the repo root).
    const repoRoot = path.resolve(e2eRoot, '..')
    const entry = path.join(tmpDir, path.relative(repoRoot, appDir), '.pylon', 'server.mjs')
    expect(existsSync(entry), 'traced server entry should exist').toBe(true)
    server = spawn('node', [entry], {
      cwd: os.tmpdir(),
      env: {...process.env, PORT: String(PORT), PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    server.stdout?.on('data', d => log.push(String(d)))
    server.stderr?.on('data', d => log.push(String(d)))

    await waitForReady()
    html = await (await fetch(`${base}/`)).text()
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
    if (tmpDir) await fs.rm(tmpDir, {recursive: true, force: true}).catch(() => {})
  })

  it('SSR-renders the page (react traced in via the usePages SSR chunks)', () => {
    expect(html).toContain('Post 1<')
    expect(html).toContain('Post 20<')
  })

  it('serves GraphQL from the isolated artifact', async () => {
    const res = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({query: '{ __typename }'})
    })
    const j = (await res.json()) as {data?: {__typename?: string}}
    expect(j.data?.__typename).toBe('Query')
  })
})
