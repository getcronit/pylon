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
const cliBin = path.resolve(e2eRoot, '../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/dev-pages-app')
const pageFile = path.join(appDir, 'pages/page.tsx')
const srcFile = path.join(appDir, 'src/index.ts')

const PORT = 4760
const base = `http://localhost:${PORT}`

let dev: ChildProcess | undefined
let originalPage = ''
let originalSrc = ''
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
    originalSrc = await fs.readFile(srcFile, 'utf8')
    await fs.rm(path.join(appDir, '.pylon'), {recursive: true, force: true})

    // Default runner (node + tsx loader on the generated .pylon/server.mjs, which
    // self-serves) — no `-c` override; the old `node .pylon/index.js` entry is gone.
    dev = spawn('node', [cliBin, 'dev'], {
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
    if (originalSrc) await fs.writeFile(srcFile, originalSrc)
    await fs.rm(path.join(appDir, 'src/widget.ts'), {force: true}).catch(() => {})
    await fs.rm(path.join(appDir, 'components'), {recursive: true, force: true}).catch(() => {})
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

  // (Tier-0 SSE live-reload removed — Vite owns browser reloads now: Fast Refresh for
  // component edits, a Vite full-reload on src edits. See rfcs/DEV_SERVER.md 3c.)

  it('rebuilds when a component imported from OUTSIDE pages/ is edited', async () => {
    // The component lives in a top-level dir that the old watcher (src/pages/public)
    // didn't cover — editing it must still trigger a rebuild via the import graph.
    const gadgetFile = path.join(appDir, 'components/Gadget.tsx')
    await fs.mkdir(path.join(appDir, 'components'), {recursive: true})
    await fs.writeFile(gadgetFile, 'export function Gadget() { return <span>GADGET_V1</span> }\n')
    await fs.writeFile(
      pageFile,
      "import {Gadget} from '../components/Gadget'\n" +
        'export default function Page() { return <h1>MARKER_C <Gadget /></h1> }\n'
    )
    await waitFor(
      async () => ((await pageHtml())?.includes('GADGET_V1')) ?? false,
      90_000,
      'component-importing page served (GADGET_V1)'
    )

    // Edit ONLY the out-of-tree component.
    await fs.writeFile(gadgetFile, 'export function Gadget() { return <span>GADGET_V2</span> }\n')
    await waitFor(
      async () => ((await pageHtml())?.includes('GADGET_V2')) ?? false,
      90_000,
      'edited out-of-tree component reflected (GADGET_V2)'
    )
    expect((await pageHtml())?.includes('GADGET_V2')).toBe(true)
  }, 150_000)

  it('reflects a SRC (schema) edit — cache invalidates, never serves a stale schema', async () => {
    // The schema build is cached (keyed by the type program's source files) to skip
    // the ~1s introspection on page/component edits. This guards the OTHER half: a
    // resolver edit MUST invalidate that cache so the new field is actually served.
    const q = async (query: string) => {
      const res = await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({query})
      })
      return res.ok ? ((await res.json()) as any) : null
    }
    // Baseline: the new field does not exist yet.
    expect((await q('{ pong }'))?.errors, 'pong should not exist yet').toBeTruthy()

    await fs.writeFile(
      srcFile,
      "import {Pylon} from '@getcronit/pylon'\n" +
        'export default new Pylon({graphql: {Query: {ping: (): string => "ok", pong: (): string => "pong"}, Mutation: {}}})\n'
    )
    await waitFor(
      async () => (await q('{ pong }'))?.data?.pong === 'pong',
      90_000,
      'new resolver served after src edit (cache invalidated)'
    )
    expect((await q('{ pong }'))?.data?.pong).toBe('pong')
  }, 120_000)

  it('reflects a SUB-FILE (transitive import) edit — cache key covers the whole import graph', async () => {
    // The schema cache is keyed by the type program's source files (entry + every
    // transitive import). Editing a sub-file the entry imports MUST invalidate it —
    // guards against a future change narrowing the key to just the entry file.
    const widgetFile = path.join(appDir, 'src/widget.ts')
    const type = async (name: string) => {
      const res = await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({query: `{ __type(name:"${name}"){ fields { name } } }`})
      })
      const j = res.ok ? ((await res.json()) as any) : null
      return (j?.data?.__type?.fields ?? []).map((f: any) => f.name)
    }

    await fs.writeFile(widgetFile, 'export class Widget {\n  id!: string\n}\n')
    await fs.writeFile(
      srcFile,
      "import {Pylon} from '@getcronit/pylon'\n" +
        "import {Widget} from './widget'\n" +
        'export default new Pylon({graphql: {Query: {widget: (): Widget => ({id: "1"} as Widget), ping: (): string => "ok"}, Mutation: {}}})\n'
    )
    await waitFor(async () => (await type('Widget')).includes('id'), 90_000, 'Widget type appears')
    expect(await type('Widget')).not.toContain('label')

    // Edit ONLY the sub-file — add a field.
    await fs.writeFile(widgetFile, 'export class Widget {\n  id!: string\n  label!: string\n}\n')
    await waitFor(
      async () => (await type('Widget')).includes('label'),
      90_000,
      'sub-file edit reflected in schema (Widget.label)'
    )
    expect(await type('Widget')).toEqual(expect.arrayContaining(['id', 'label']))
  }, 120_000)

  it('hot-swaps a SRC edit WITHOUT restarting the worker (same pid)', async () => {
    // Step 2: a `src` edit re-executes the app graph via the rolldown-vite module
    // runner and swaps Yoga's schema IN the running worker — no restart. Proof: a
    // resolver reports `process.pid`; a resolver-only edit must change the returned
    // value while the pid stays identical (the durable worker never died).
    const q = async (query: string) => {
      const res = await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({query})
      })
      return res.ok ? ((await res.json()) as any) : null
    }
    const appSrc = (v: string) =>
      "import {Pylon} from '@getcronit/pylon'\n" +
      `export default new Pylon({graphql: {Query: {mark: (): string => "${v}", pid: (): number => process.pid}, Mutation: {}}})\n`

    await fs.writeFile(srcFile, appSrc('SWAP_V1'))
    await waitFor(async () => (await q('{ mark }'))?.data?.mark === 'SWAP_V1', 90_000, 'mark SWAP_V1')
    const pidBefore = (await q('{ pid }'))?.data?.pid
    expect(pidBefore, 'worker pid should be readable').toBeTruthy()

    // Resolver-only edit (no schema change) → pure server hot-swap, no client/pages rebuild.
    await fs.writeFile(srcFile, appSrc('SWAP_V2'))
    await waitFor(async () => (await q('{ mark }'))?.data?.mark === 'SWAP_V2', 60_000, 'mark SWAP_V2')

    const pidAfter = (await q('{ pid }'))?.data?.pid
    expect(pidAfter, 'worker must be the SAME process — no restart').toBe(pidBefore)

    // Schema-CHANGING edit (adds a field) → also regens client + pages and swaps them,
    // but STILL must not restart. Guards against the swap silently falling back to a
    // restart (which would also make the field appear, masking a half-working Step 2).
    await fs.writeFile(
      srcFile,
      "import {Pylon} from '@getcronit/pylon'\n" +
        'export default new Pylon({graphql: {Query: {mark: (): string => "SWAP_V2", extra: (): string => "added", pid: (): number => process.pid}, Mutation: {}}})\n'
    )
    await waitFor(async () => (await q('{ extra }'))?.data?.extra === 'added', 60_000, 'new field `extra` served')
    const pidAfterSchema = (await q('{ pid }'))?.data?.pid
    expect(pidAfterSchema, 'schema-changing edit must ALSO hot-swap, not restart').toBe(pidBefore)
  }, 150_000)
})
