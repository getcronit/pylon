/**
 * Dev-loop harness: spawns the real `pylon dev` against a minimal pages app and
 * exercises the WATCH path the other e2es don't (they use one-shot `pylon build`).
 *
 * Today this asserts the baseline: a page edit is eventually SERVED (watch →
 * rebuild → restart → serve). It's the verification target for the usePages
 * pipeline work — once dev artifact hot-reload lands (#1), this same test gains a
 * "the server PID did NOT change" assertion to prove the edit reflected WITHOUT a
 * full reboot.
 *
 * No DB / docker needed (pages-only app).
 */
import {type ChildProcess, spawn} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/dev-pages-app')
const pageFile = path.join(appDir, 'pages/page.tsx')

const PORT = 4760
const base = `http://localhost:${PORT}`

let dev: ChildProcess | undefined
let originalPage = ''
const devLog: string[] = []

const recentLog = (n = 40) => devLog.slice(-n).join('')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function pageHtml(): Promise<string | null> {
  try {
    const res = await fetch(`${base}/`)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return
    await sleep(500)
  }
  throw new Error(`timed out (${timeoutMs}ms) waiting for ${label}`)
}

// Verifies the dev Supervisor sequencing (build server → gqty client → pages →
// restart): a pages app serves in dev, and a page edit reflects through the watch
// loop. This is the path no other e2e covers (they're one-shot build / non-pages).
describe('pylon dev — pages watch loop', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    originalPage = await fs.readFile(pageFile, 'utf8')
    await fs.rm(path.join(appDir, '.pylon'), {recursive: true, force: true})

    dev = spawn('node', [cliBin, 'dev', '-c', 'node .pylon/index.js'], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(PORT),
        PYLON_TELEMETRY_DISABLED: '1',
        DO_NOT_TRACK: '1'
      }
    })
    dev.stdout?.on('data', d => devLog.push(d.toString()))
    dev.stderr?.on('data', d => devLog.push(d.toString()))

    // First build + client gen + server boot can take a while.
    await waitFor(
      async () => ((await pageHtml())?.includes('MARKER_V1')) ?? false,
      120_000,
      'initial page render (MARKER_V1)'
    )
  }, 150_000)

  afterAll(async () => {
    if (dev?.pid) {
      try {
        dev.kill('SIGINT') // dev's SIGINT handler tears down its server child
      } catch {
        /* already gone */
      }
      await sleep(1500)
      try {
        dev.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    if (originalPage) await fs.writeFile(pageFile, originalPage)
    await fs.rm(path.join(appDir, '.pylon'), {recursive: true, force: true}).catch(() => {})
  }, 30_000)

  it('serves the initial page', async () => {
    expect((await pageHtml())?.includes('MARKER_V1')).toBe(true)
  })

  it('reflects a page edit through the watch loop (rebuild → restart → serve)', async () => {
    const logFrom = devLog.length
    await fs.writeFile(pageFile, originalPage.replaceAll('MARKER_V1', 'MARKER_V2'))
    try {
      await waitFor(
        async () => ((await pageHtml())?.includes('MARKER_V2')) ?? false,
        90_000,
        'edited page served (MARKER_V2)'
      )
    } catch (e) {
      const onDisk = await fs.readFile(pageFile, 'utf8').catch(() => '<unreadable>')
      const lastHtml = await pageHtml()
      console.error(
        [
          '\n=== edit-reflect FAILED — diagnostics ===',
          `page.tsx on disk:\n${onDisk}`,
          `last served HTML marker: ${lastHtml?.match(/MARKER_V[12]/)?.[0] ?? '<none>'}`,
          `dev log since edit:\n${devLog.slice(logFrom).join('')}`,
          `dev log tail:\n${recentLog()}`
        ].join('\n')
      )
      throw e
    }
    const html = await pageHtml()
    expect(html?.includes('MARKER_V2')).toBe(true)
    expect(html?.includes('MARKER_V1')).toBe(false)
  }, 120_000)
})
