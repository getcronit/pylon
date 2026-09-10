/**
 * End-to-end guard for `create-pylon`: scaffold a project with the SHIPPED CLI, then
 * run the SHIPPED `pylon build` on it — for every runtime, and for each feature combo.
 *
 * This exists because the templates silently rotted against the framework. `create-pylon`
 * was still emitting the pre-`Pylon`-class contract (`export const graphql` + a
 * `serve(app, …)` side effect in the entry, `pylon dev -c "<cmd>"`), so EVERY runtime it
 * produced failed on the very first `pylon build` — with either "Pylon entry must export
 * default the app" or, worse, a silent drop of the resolvers surfacing much later as
 * "Query root type must be provided". Nothing caught it: create-pylon has no tests and the
 * e2e fixtures are hand-written, so they were migrated while the templates were not.
 *
 * The contract this locks down, per the current framework:
 *   - the entry is `export default new Pylon({graphql})` — the compiler type-introspects
 *     the DEFAULT export; a named `graphql` export is ignored,
 *   - the entry is PURE: serving is app-owned and declared in `pylon.config.ts`
 *     (`useNodeServer()` on Node, nothing on Bun/Deno/workerd — those serve the default
 *     export of `.pylon/server.mjs` themselves),
 *   - `useNodeServer()` is a 'last'-strategy plugin and must come LAST in `plugins`, after
 *     the usePages catch-all, or the port binds before every route is mounted,
 *   - `pylon dev` takes no `-c/--command` — dev is direct in-process execution.
 *
 * The node case goes furthest: it boots the built artifact and queries it over HTTP, which
 * is the only assertion that would catch serving silently regressing to a no-op.
 *
 * Scaffolds land under `e2e/.tmp-create-pylon/` on purpose — Node resolution walks up to
 * `e2e/node_modules`, so a scaffold resolves the workspace `@getcronit/pylon` (and the
 * `pages` feature's React/shadcn deps) without a network install. Nothing here hits npm;
 * the templates pin `@getcronit/pylon@^3.0.0`, which is not published yet.
 */
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, GraphQLObjectType} from 'graphql'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const pylonBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const createBin = path.join(repoRoot, 'packages/create-pylon/dist/index.js')
const workDir = path.resolve(dir, '../.tmp-create-pylon')

/** Telemetry off, and never let a stray PORT leak in from the shell. */
const env = {
  ...process.env,
  PYLON_DISABLE_TELEMETRY: 'true',
  PYLON_TELEMETRY_DISABLED: '1',
  DO_NOT_TRACK: '1',
  PORT: undefined as unknown as string
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

const run = (cmd: string, args: string[], cwd: string, timeout = 180_000): Promise<Run> =>
  new Promise(resolve => {
    const child = spawn(cmd, args, {cwd, env})
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('close', status => {
      clearTimeout(timer)
      resolve({status, stdout, stderr})
    })
  })

/** An ephemeral free port, so parallel/repeat runs never collide. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const {port} = srv.address() as {port: number}
      srv.close(() => resolve(port))
    })
  })

/**
 * Boot a built `.pylon/server.mjs` on a free port, run `probe` against it once it
 * answers, and always tear the process down. `probe` is retried while the socket is
 * still refusing connections — the port binds during `executeConfig`, not at spawn.
 */
const withServer = async <T>(
  appDir: string,
  probe: (baseUrl: string) => Promise<T>
): Promise<T> => {
  const port = await freePort()
  const server = spawn('node', [path.join(appDir, '.pylon/server.mjs')], {
    cwd: appDir,
    env: {...env, PORT: String(port)}
  })
  let log = ''
  server.stdout.on('data', d => (log += d))
  server.stderr.on('data', d => (log += d))

  try {
    const baseUrl = `http://127.0.0.1:${port}`
    let lastErr: unknown
    for (let i = 0; i < 60; i++) {
      try {
        return await probe(baseUrl)
      } catch (err) {
        lastErr = err
        await new Promise(r => setTimeout(r, 250))
      }
    }
    throw new Error(
      `server never answered on ${port}: ${String(lastErr)}\nServer log:\n${log}`
    )
  } finally {
    server.kill('SIGKILL')
  }
}

type Runtime = 'node' | 'bun' | 'cf-workers' | 'deno'

interface Case {
  name: string
  runtime: Runtime
  features: string[]
}

/** cf-workers and deno don't advertise `pages`; only the combos the CLI accepts. */
const CASES: Case[] = [
  {name: 'node', runtime: 'node', features: []},
  {name: 'bun', runtime: 'bun', features: []},
  {name: 'cf-workers', runtime: 'cf-workers', features: []},
  {name: 'deno', runtime: 'deno', features: []},
  {name: 'node-auth', runtime: 'node', features: ['auth']},
  {name: 'node-pages', runtime: 'node', features: ['pages']}
]

interface Result {
  dir: string
  scaffold: Run
  build: Run
  entry: string
  config: string
  manifest: string
  sdl?: string
}

const results = new Map<string, Result>()

beforeAll(async () => {
  for (const bin of [pylonBin, createBin]) {
    if (!existsSync(bin)) {
      throw new Error(`Not built: ${bin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
  }

  await fs.rm(workDir, {recursive: true, force: true})
  await fs.mkdir(workDir, {recursive: true})

  // Scaffold + build every case concurrently — they are independent processes and
  // sequential runs would blow the hook timeout.
  await Promise.all(
    CASES.map(async c => {
      const appDir = path.join(workDir, c.name)
      const scaffold = await run(
        'node',
        [
          createBin,
          c.name,
          '-r',
          c.runtime,
          '--features',
          ...c.features,
          '--no-install',
          '--yes',
          '-pm',
          'npm'
        ],
        workDir
      )

      const read = async (p: string) =>
        existsSync(path.join(appDir, p)) ? fs.readFile(path.join(appDir, p), 'utf8') : ''

      const result: Result = {
        dir: appDir,
        scaffold,
        build: {status: null, stdout: '', stderr: ''},
        entry: await read('src/index.ts'),
        config: await read('pylon.config.ts'),
        // deno keeps its scripts in deno.json; every other runtime in package.json
        manifest: (await read('package.json')) + (await read('deno.json'))
      }

      if (scaffold.status === 0) {
        result.build = await run('node', [pylonBin, 'build'], appDir)
        const sdlPath = path.join(appDir, '.pylon/schema.graphql')
        if (existsSync(sdlPath)) result.sdl = await fs.readFile(sdlPath, 'utf8')
      }

      results.set(c.name, result)
    })
  )
}, 600_000)

afterAll(async () => {
  await fs.rm(workDir, {recursive: true, force: true})
})

const get = (name: string) => {
  const r = results.get(name)
  if (!r) throw new Error(`no result for ${name}`)
  return r
}

describe.each(CASES)('create-pylon scaffold: $name', c => {
  it('scaffolds non-interactively', () => {
    const r = get(c.name)
    expect(r.scaffold.status, r.scaffold.stderr || r.scaffold.stdout).toBe(0)
    expect(r.entry).not.toBe('')
    expect(r.config).not.toBe('')
  })

  it('emits the current entry contract (default-exported Pylon, no named graphql)', () => {
    const r = get(c.name)
    expect(r.entry).toContain('export default new Pylon(')
    // The pre-migration contract. Both forms build a schema-less app, and the second
    // fails LATE ("Query root type must be provided") rather than at the entry check.
    expect(r.entry).not.toContain('export const graphql')
    expect(r.entry).not.toMatch(/export default app\b/)
  })

  it('keeps the entry pure — serving is declared in pylon.config, not imported for effect', () => {
    const r = get(c.name)
    expect(r.entry).not.toContain('@hono/node-server')
    expect(r.entry).not.toMatch(/\bserve\(/)
    expect(r.entry).not.toContain('Deno.serve')
  })

  it('scaffolds a dev script the CLI actually accepts', () => {
    // `pylon dev` is direct in-process execution; the `-c/--command` flag was removed
    // and now hard-errors with `unknown option '-c'`.
    expect(get(c.name).manifest).not.toMatch(/pylon dev\s+-c/)
  })

  it('builds with the shipped `pylon build`', () => {
    const r = get(c.name)
    expect(r.build.status, r.build.stderr || r.build.stdout).toBe(0)
    expect(r.sdl, 'no .pylon/schema.graphql emitted').toBeTruthy()
  })

  it('compiles the resolvers into the schema', () => {
    const query = buildSchema(get(c.name).sdl!).getQueryType() as GraphQLObjectType
    const hello = query.getFields().hello
    expect(hello).toBeDefined()
    expect(String(hello.type)).toBe('String!')
  })
})

describe('serving', () => {
  it('declares useNodeServer() last on Node, and not at all elsewhere', () => {
    // A 'last'-strategy plugin: ordered after usePages so the port binds only once the
    // catch-all route is mounted. On Bun/Deno/workerd the host serves the default export.
    const nodeConfig = get('node').config
    expect(nodeConfig).toContain('useNodeServer()')
    expect(nodeConfig).toMatch(/useNodeServer\(\)\s*\]/)

    const pagesConfig = get('node-pages').config
    expect(pagesConfig).toMatch(/usePages\(\).*useNodeServer\(\)\s*\]/s)

    for (const name of ['bun', 'cf-workers', 'deno']) {
      expect(get(name).config, name).not.toContain('useNodeServer')
    }
  })

  it('boots the built Node artifact and answers a GraphQL query', async () => {
    const body = await withServer(get('node').dir, async baseUrl => {
      const res = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({query: '{hello}'})
      })
      return (await res.json()) as {data?: {hello?: string}}
    })
    expect(body.data?.hello).toBe('Hello, world!')
  }, 60_000)
})

describe('pages feature', () => {
  it('generates the typed query client the scaffolded pylon.d.ts augments from', async () => {
    const {dir: appDir} = get('node-pages')
    // `pylon.d.ts` does `import {Data, Mutations} from './.pylon/client'` — those types
    // only exist because the build generates them from the compiled SDL.
    const types = await fs.readFile(path.join(appDir, '.pylon/client/types.ts'), 'utf8')
    expect(types).toMatch(/export type Mutations/)
    expect(existsSync(path.join(appDir, '.pylon/client/index.ts'))).toBe(true)
  })

  it('builds the page bundles', () => {
    const {dir: appDir} = get('node-pages')
    expect(existsSync(path.join(appDir, '.pylon/__pylon'))).toBe(true)
  })

  it('server-renders the starter page with data from its own GraphQL resolver', async () => {
    const html = await withServer(get('node-pages').dir, async baseUrl => {
      const res = await fetch(`${baseUrl}/`)
      expect(res.status).toBe(200)
      return res.text()
    })

    // The full loop: usePages SSR → useData() → in-process /graphql → the entry's
    // `hello` resolver. `<title>` is authored inside the page body; React 19 hoists it.
    expect(html).toContain('<title>Hello, world!</title>')
    expect(html).toMatch(/<button[^>]*>Hello/)
    // The client bundle + the stylesheet PostCSS emits out-of-band must both be linked.
    expect(html).toMatch(/<link rel="stylesheet" href="\/__pylon\/static\/[^"]+\.css"/)
    expect(html).toMatch(/<script type="module" src="\/__pylon\/static\/[^"]+\.js"/)
  }, 60_000)

  it('emits only real Tailwind utilities on the starter Button', async () => {
    // Regression guard: the template shipped `inline-flexxx`, which Tailwind simply does
    // not generate — so the button silently lost `display: inline-flex` and the
    // `items-center justify-center gap-2` layout it depends on. A typo'd utility is
    // invisible in a build (nothing errors), so assert on the rendered markup.
    const html = await withServer(get('node-pages').dir, async baseUrl =>
      (await fetch(`${baseUrl}/`)).text()
    )
    const button = html.match(/<button[^>]*class="([^"]*)"/)?.[1]
    expect(button, 'no <button> rendered').toBeDefined()
    expect(button).toMatch(/(^|\s)inline-flex(\s|$)/)

    // …and the generated CSS must actually carry the rule the class promises.
    const cssDir = path.join(get('node-pages').dir, '.pylon/__pylon/static')
    const css = (
      await Promise.all(
        (await fs.readdir(cssDir))
          .filter(f => f.endsWith('.css'))
          .map(f => fs.readFile(path.join(cssDir, f), 'utf8'))
      )
    ).join('\n')
    expect(css).toMatch(/\.inline-flex\s*\{[^}]*display:\s*inline-flex/)
  }, 60_000)

  it('uses the LayoutProps the framework ships, not an ad-hoc children type', async () => {
    // `LayoutProps` also carries `params`, `searchParams`, `path` and `context`; typing
    // the starter layout as `{children: React.ReactNode}` hid all of that from users.
    const layout = await fs.readFile(
      path.join(get('node-pages').dir, 'pages/layout.tsx'),
      'utf8'
    )
    expect(layout).toContain("import {LayoutProps} from '@getcronit/pylon/pages'")
    expect(layout).toContain('}: LayoutProps)')
  })

  it('resolves theme colours per element so a nested `.dark` actually flips', async () => {
    // The scaffold declares `dark` as `&:is(.dark *)` — it targets DESCENDANTS of
    // `.dark`, so `.dark` need not sit on <html>. That only works with `@theme inline`:
    // a plain `@theme` emits `--color-background: hsl(var(--background))` into `:root`,
    // where substitution happens once and the resolved colour inherits down as a
    // literal — a nested `.dark` re-declaring `--background` never reaches it, and
    // `bg-background` (and even `dark:bg-card`) stay light. Verified in a browser:
    // with the indirection, a nested `.dark` left everything at rgb(255,255,255).
    // Per FILE, not concatenated: pylon ships its own stylesheet (dev overlay, status
    // pages) alongside the app's, and it uses the non-inline pattern internally.
    const cssDir = path.join(get('node-pages').dir, '.pylon/__pylon/static')
    const sheets = await Promise.all(
      (await fs.readdir(cssDir))
        .filter(f => f.endsWith('.css'))
        .map(f => fs.readFile(path.join(cssDir, f), 'utf8'))
    )

    // The app's sheet: `bg-background` carries the var() the `.dark` block overrides,
    // and the `:root` indirection that breaks nested scoping is absent from it.
    const appSheet = sheets.find(css =>
      /\.bg-background\s*\{[^}]*background-color:\s*hsl\(var\(--background\)\)/.test(css)
    )
    expect(appSheet, 'no stylesheet resolves bg-background inline').toBeDefined()
    expect(appSheet).not.toMatch(/--color-background:\s*hsl/)

    const globals = await fs.readFile(
      path.join(get('node-pages').dir, 'globals.css'),
      'utf8'
    )
    expect(globals).toContain('@theme inline {')
    expect(globals).toContain('@custom-variant dark (&:is(.dark *));')
  })

  it('marks components.json as Tailwind v4 so `shadcn add` targets the right generation', async () => {
    // v4 keeps the theme in `globals.css` under `@theme` and the scaffold emits no
    // `tailwind.config.js`; shadcn reads a non-empty `tailwind.config` as "v3".
    const raw = await fs.readFile(path.join(get('node-pages').dir, 'components.json'), 'utf8')
    const components = JSON.parse(raw)
    expect(components.tailwind.config).toBe('')
    expect(existsSync(path.join(get('node-pages').dir, 'tailwind.config.js'))).toBe(false)
  })
})
