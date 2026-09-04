import {Plugin} from '@getcronit/pylon'
import {createHash} from 'crypto'
import fs from 'fs/promises'
import {createRequire} from 'module'
import path from 'path'
import {rolldown, type RolldownOutput} from 'rolldown'
import {buildCatalogs} from './catalogs'

// Resolve from the app's location via real Node resolution — robust to pnpm /
// monorepo / hoisted layouts where the package isn't under `cwd/node_modules`.
const nodeRequire = createRequire(path.join(process.cwd(), 'noop.js'))
import {makeAppFiles} from './app-utils'
import {
  assetFilePlugin,
  cssCollectPlugin,
  imagePlugin,
  injectAppHydrationPlugin,
  processCssFile
} from './rolldown-plugins'
import {StaticAnalysisManager} from './plugins/use-data-static-analyzer/manager'
import {useDataStaticAnalyzerRolldown} from './plugins/use-data-static-analyzer'
import type {UsePagesOptions} from '..'

const DIST_STATIC_DIR = path.join(process.cwd(), '.pylon/__pylon/static')
const DIST_PAGES_DIR = path.join(process.cwd(), '.pylon/__pylon/pages')
const PUBLIC_PATH = '/__pylon/static'

/** Packages kept external in the node/SSR bundle (resolved at runtime). Workspace-linked
 *  packages resolve OUTSIDE node_modules, so the framework's own packages are still listed
 *  explicitly here; everything else in node_modules is externalized by the plugin below. */
const SERVER_EXTERNALS = [
  '@getcronit/pylon',
  '@getcronit/pylon/pages',
  '@getcronit/pylon/query',
  'react',
  'react-dom'
]

/**
 * Keep node_modules external in the SSR/node bundle. SSR runs in Node, where dependencies
 * are on disk — so bundling them is pure downside: it duplicates singletons and BREAKS any
 * dep that dynamically `require`s its own data files (e.g. `i18n-iso-countries`'s
 * `langs/*.json`, which don't exist next to the emitted chunk). Resolve each bare import;
 * if it lands in node_modules, mark it external (keeping the bare specifier so Node resolves
 * it at runtime). App code — relative imports and tsconfig path aliases (`@/…`, which resolve
 * to project files, not node_modules) — is left to bundle.
 */
// CSS/asset imports (even from node_modules, e.g. `nprogress/nprogress.css`) must NOT be
// externalized — Node can't load them at runtime; the css/image/asset plugins handle them.
// `.json` is included: a bundler-visible `import x from "pkg/x.json"` (e.g. the app importing
// `i18n-iso-countries/langs/de.json`) kept external crashes at runtime under Node's strict ESM
// loader (`ERR_IMPORT_ATTRIBUTE_MISSING` — no `with { type: 'json' }`). Inlining it is the
// bundler's job (rolldown parses JSON natively — the client bundle already does this). This
// does NOT affect a dep that dynamically `require`s its OWN `langs/*.json` at runtime: that
// dep's JS stays external, so its internal requires still resolve from node_modules on disk.
const NON_JS_ASSET = /\.(css|scss|sass|less|styl|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|otf|json)$/i

const ssrExternalizeNodeModules = () => ({
  name: 'pylon:ssr-externalize-node-modules',
  async resolveId(this: any, id: string, importer: string | undefined, options: any) {
    if (!importer || id[0] === '.' || path.isAbsolute(id)) return null
    const resolved = await this.resolve(id, importer, {skipSelf: true, ...options})
    if (
      resolved &&
      !resolved.external &&
      resolved.id.includes(`${path.sep}node_modules${path.sep}`) &&
      !NON_JS_ASSET.test(resolved.id)
    ) {
      return {id, external: true}
    }
    return null
  }
})

async function updateFileIfChanged(filePath: string, newContent: Buffer) {
  await fs.mkdir(path.dirname(filePath), {recursive: true})
  try {
    const current = await fs.readFile(filePath)
    if (current.equals(newContent)) {
      // Content unchanged → skip the rewrite, but bump the mtime so the dev prune
      // (`pruneStaleOutputs`, which sweeps files untouched for a grace window) treats this
      // still-current, still-referenced file as fresh. Without this, a file that rarely
      // changes but is always in the manifest — the framework `index.css` — keeps its old
      // mtime, gets pruned, and its manifest link 404s. The prune's safety depends on every
      // current output being touched each rebuild; this keeps that invariant.
      const now = new Date()
      await fs.utimes(filePath, now, now).catch(() => {})
      return false
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
  await fs.writeFile(filePath, newContent)
  return true
}

const scalarTypes = {Number: 'number', JSONObject: 'Record<string, unknown>'}

export const build = async (
  _ctx: Parameters<NonNullable<Plugin['build']>>[0],
  options: UsePagesOptions = {}
): Promise<Awaited<ReturnType<NonNullable<Plugin['build']>>>> => {
  const version = Math.random().toString(36).substring(7)
  const cwd = process.cwd()
  const appTsxAbs = path.resolve(cwd, '.pylon', 'app.tsx')
  const sitemapAbs = path.resolve(cwd, 'pages', 'sitemap.ts')
  const pylonCssPath = nodeRequire.resolve('@getcronit/pylon/pages/index.css')

  // Catalogs are owned by the build because `catalogs` is a configured path: compile each
  // locale into `.pylon/messages/<locale>.js` so the runtime can import it regardless of
  // where the app keeps its sources.
  const buildMessageCatalogs = async () => {
    const i18n = options.i18n
    if (!i18n?.catalogs) return
    await buildCatalogs({
      cwd,
      dir: i18n.catalogs,
      locales: i18n.locales,
      defaultLocale: i18n.defaultLocale
    })
  }

  const define = {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development'
    )
  }
  const transform = {jsx: 'react-jsx', target: 'es2020', define} as const

  // Sentry is opt-in via `usePages({sentry: true})`. When enabled the app must
  // have `@sentry/react` installed; otherwise a plain console error handler is
  // used and Sentry is never imported into the client bundle.
  const sentryEnabled = options.sentry === true

  // One shared ts-morph analysis manager — its project + caches persist across
  // rebuilds and both (client/server) builds, so incremental analysis stays warm.
  const tsConfigPath = path.join(cwd, 'tsconfig.json')
  const tsConfigExists = await fs
    .access(tsConfigPath)
    .then(() => true)
    .catch(() => false)
  const analysisManager = new StaticAnalysisManager({
    tsConfigFilePath: tsConfigExists ? tsConfigPath : undefined
  })

  const buildAppFile = async () => {
    const appFiles = makeAppFiles()
    await updateFileIfChanged(appTsxAbs, Buffer.from(appFiles.routes))
  }

  const copyPublicDir = async () => {
    const publicDir = path.resolve(cwd, 'public')
    const pylonPublicDir = path.resolve(cwd, '.pylon', '__pylon', 'public')
    try {
      await fs.access(publicDir)
      await fs.mkdir(pylonPublicDir, {recursive: true})
      await fs.cp(publicDir, pylonPublicDir, {recursive: true, force: true})
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  const sitemapExists = async () =>
    fs
      .access(sitemapAbs)
      .then(() => true)
      .catch(() => false)

  /** Build the browser bundle: hydration entry + app CSS graph → static dir. */
  const runClientBuild = async () => {
    const t = Date.now()
    const collectedCss = new Map<string, string>()

    const bundle = await rolldown({
      input: {app: appTsxAbs},
      cwd,
      platform: 'browser',
      transform,
      plugins: [
        injectAppHydrationPlugin(version, appTsxAbs, sentryEnabled),
        useDataStaticAnalyzerRolldown({
          debug: true,
          // Compiled operations carry `@inContext` locale only when the app configured i18n.
          // (The per-op `context` channel is always compiled in — see compileOperation.)
          inContext: Boolean(options.i18n),
          manager: analysisManager,
          entryPaths: [appTsxAbs],
          scalarTypes
        }),
        cssCollectPlugin(collectedCss, {
          outputDir: DIST_STATIC_DIR,
          publicPath: PUBLIC_PATH
        }),
        imagePlugin({mediaDir: path.join(DIST_STATIC_DIR, 'media'), publicPath: PUBLIC_PATH}),
        assetFilePlugin(PUBLIC_PATH)
      ]
    })

    const out = await bundle.write({
      dir: DIST_STATIC_DIR,
      format: 'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      assetFileNames: 'assets/[name]-[hash][extname]',
      sourcemap: true,
      minify: false
    })
    await bundle.close()

    await writeClientManifest(out, collectedCss)
    console.log(`Pages [client] Rebuild took ${Date.now() - t}ms`)
  }

  /** Build the node/SSR bundle: routes module (+ optional sitemap) → pages dir. In dev
   *  (`writeCssAssets`) this build ALSO owns CSS: it resolves url() assets and returns
   *  the collected graph, so no separate client build is needed. */
  const runServerBuild = async (writeCssAssets = false) => {
    const t = Date.now()
    const hasSitemap = await sitemapExists()
    const collectedCss = new Map<string, string>()

    const bundle = await rolldown({
      input: {
        app: appTsxAbs,
        ...(hasSitemap ? {sitemap: sitemapAbs} : {})
      },
      cwd,
      platform: 'node',
      transform,
      external: id =>
        SERVER_EXTERNALS.some(e => id === e || id.startsWith(`${e}/`)),
      plugins: [
        ssrExternalizeNodeModules(),
        useDataStaticAnalyzerRolldown({
          debug: true,
          // Compiled operations carry `@inContext` locale only when the app configured i18n.
          // (The per-op `context` channel is always compiled in — see compileOperation.)
          inContext: Boolean(options.i18n),
          manager: analysisManager,
          entryPaths: [appTsxAbs, ...(hasSitemap ? [sitemapAbs] : [])],
          scalarTypes
        }),
        cssCollectPlugin(
          collectedCss,
          writeCssAssets
            ? {outputDir: DIST_STATIC_DIR, publicPath: PUBLIC_PATH}
            : undefined
        ),
        imagePlugin({
          mediaDir: path.join(DIST_STATIC_DIR, 'media'),
          publicPath: PUBLIC_PATH,
          // Dev SSR emits just the URL to match the Vite client (no hydration mismatch);
          // prod keeps the full blur/dimensions optimization.
          dev: writeCssAssets
        }),
        assetFilePlugin(PUBLIC_PATH)
      ]
    })

    const out = await bundle.write({
      dir: DIST_PAGES_DIR,
      format: 'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      assetFileNames: 'assets/[name]-[hash][extname]',
      sourcemap: 'inline',
      // Don't minify the node-only SSR bundle in dev — pure rebuild cost with no
      // benefit. `PYLON_DEV` is set only by `pylon dev`.
      minify: !process.env.PYLON_DEV
    })
    await bundle.close()

    await writeServerManifest(out, hasSitemap)
    console.log(`Pages [server] Rebuild took ${Date.now() - t}ms`)
    return collectedCss
  }

  /** Write the framework base stylesheet + concatenated app CSS to the static dir and
   *  return their manifest entries (public URLs). Shared by the prod client build and
   *  the dev CSS-only path. */
  const writeCssFiles = async (
    collectedCss: Map<string, string>
  ): Promise<Record<string, string>> => {
    const entries: Record<string, string> = {}

    // Framework base stylesheet — resolve any url() assets it references too.
    const indexCss = await processCssFile(pylonCssPath, {
      outputDir: DIST_STATIC_DIR,
      publicPath: PUBLIC_PATH
    })
    const indexName = `index-${hashCss(indexCss)}.css`
    await updateFileIfChanged(
      path.join(DIST_STATIC_DIR, indexName),
      Buffer.from(indexCss)
    )
    entries['index.css'] = `${PUBLIC_PATH}/${indexName}`

    // App CSS graph — concatenated in import order (see rolldown-plugins.ts).
    const appCss = [...collectedCss.values()].join('\n')
    if (appCss.trim()) {
      const appName = `app-${hashCss(appCss)}.css`
      await updateFileIfChanged(
        path.join(DIST_STATIC_DIR, appName),
        Buffer.from(appCss)
      )
      entries['app.css'] = `${PUBLIC_PATH}/${appName}`
    }
    return entries
  }

  /** Client manifest: URLs (served under /__pylon/static) for HTML links/scripts. */
  const writeClientManifest = async (
    out: RolldownOutput,
    collectedCss: Map<string, string>
  ) => {
    const manifest: Record<string, string> = {}

    for (const chunk of out.output) {
      if (chunk.type !== 'chunk' || !chunk.isEntry) continue
      if (chunk.facadeModuleId === appTsxAbs) {
        manifest['app.js'] = `${PUBLIC_PATH}/${chunk.fileName}`
      }
    }

    Object.assign(manifest, await writeCssFiles(collectedCss))
    manifest['version'] = version

    await updateFileIfChanged(
      path.join(DIST_STATIC_DIR, 'manifest.json'),
      Buffer.from(JSON.stringify(manifest, null, 2))
    )
  }

  /** Dev: Vite serves the client JS, so the static manifest carries ONLY the CSS (no
   *  app.js) — the SSR precedence `<link>`s that give styled first paint. The CSS comes
   *  from the server build's collected graph, so no separate client build runs. */
  const writeDevStaticManifest = async (collectedCss: Map<string, string>) => {
    const manifest: Record<string, string> = {
      ...(await writeCssFiles(collectedCss)),
      version
    }
    await updateFileIfChanged(
      path.join(DIST_STATIC_DIR, 'manifest.json'),
      Buffer.from(JSON.stringify(manifest, null, 2))
    )
  }

  /** Server manifest: cwd-relative fs paths (imported via `${cwd}/${path}`). */
  const writeServerManifest = async (
    out: RolldownOutput,
    hasSitemap: boolean
  ) => {
    const manifest: Record<string, string> = {}
    const relDir = path.relative(cwd, DIST_PAGES_DIR).split(path.sep).join('/')

    for (const chunk of out.output) {
      if (chunk.type !== 'chunk' || !chunk.isEntry) continue
      if (chunk.facadeModuleId === appTsxAbs) {
        manifest['app.js'] = `${relDir}/${chunk.fileName}`
      } else if (hasSitemap && chunk.facadeModuleId === sitemapAbs) {
        manifest['sitemap.js'] = `${relDir}/${chunk.fileName}`
      }
    }

    manifest['version'] = version

    await updateFileIfChanged(
      path.join(DIST_PAGES_DIR, 'manifest.json'),
      Buffer.from(JSON.stringify(manifest, null, 2))
    )
  }

  // Returns a BuildController (rebuild/dispose/cancel). The Supervisor drives
  // rebuild() on every change via its own chokidar watcher; each rebuild spins a
  // fresh rolldown build (the expensive ts-morph analysis manager is reused).
  return {
    dispose: async () => {},
    rebuild: async () => {
      // PROD: clean the hashed-output dirs UP FRONT so stale bundles don't accumulate.
      // DEV: do NOT delete the live output before the new bundle is written — the SSR runtime
      // resolves each matched route's `lazy()` on the server (React Router `createStaticHandler`),
      // so a request landing mid-rebuild would `import()` a just-deleted route chunk and fail.
      // New files are content-hashed (they coexist with the old) and the manifest is swapped
      // atomically via `updateFileIfChanged`, so the swap is seamless. We sweep the now-stale
      // generations AFTER the new build instead (see `pruneStaleOutputs`). `public` is a sibling
      // dir, untouched.
      if (!process.env.PYLON_DEV) {
        await Promise.all([
          fs.rm(DIST_STATIC_DIR, {recursive: true, force: true}),
          fs.rm(DIST_PAGES_DIR, {recursive: true, force: true})
        ])
      }
      await buildAppFile()
      await copyPublicDir()
      // Before either bundle: the SSR runtime imports these at request time, and a dev
      // rebuild must pick up an edited catalog.
      await buildMessageCatalogs()
      if (process.env.PYLON_DEV) {
        // Dev: Vite serves the client, so the rolldown client JS bundle is dead weight.
        // Skip it — the server build traverses the same graph and now writes the CSS
        // (the SSR precedence `<link>`s), so one build does it all.
        const collectedCss = await runServerBuild(true)
        await writeDevStaticManifest(collectedCss)
        // Race-free cleanup: with the up-front clean skipped in dev, sweep the prior
        // generations now that the new bundle + manifest are in place — but only files
        // untouched for a grace window, so any SSR request still mid-flight against the
        // previous bundle keeps its chunks. Bounds `.pylon` growth without reintroducing
        // the delete-before-write race.
        await Promise.all([
          pruneStaleOutputs(DIST_PAGES_DIR),
          pruneStaleOutputs(DIST_STATIC_DIR)
        ])
      } else {
        await Promise.all([runClientBuild(), runServerBuild()])
      }
    },
    cancel: async () => {}
  }
}

/**
 * Delete content-hashed dev bundles left behind by skipping the up-front clean. Only files
 * whose last write was more than `graceMs` ago are removed, so a fresh build's outputs (just
 * written) and anything an in-flight SSR request is still importing survive; genuinely stale
 * generations from earlier in the session are swept. `manifest.json` is stable-named (written
 * via `updateFileIfChanged`, so it may keep an old mtime) and is always kept.
 */
async function pruneStaleOutputs(dir: string, graceMs = 15_000): Promise<void> {
  const cutoff = Date.now() - graceMs
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = (await fs.readdir(dir, {recursive: true, withFileTypes: true})) as any
  } catch {
    return // dir may not exist yet on the very first build
  }
  await Promise.all(
    (entries as any[]).map(async e => {
      if (!e.isFile() || e.name === 'manifest.json') return
      const p = path.join(e.parentPath ?? dir, e.name)
      try {
        const st = await fs.stat(p)
        if (st.mtimeMs < cutoff) await fs.rm(p, {force: true})
      } catch {
        // raced with another rebuild's sweep — fine, it's gone either way
      }
    })
  )
}

function hashCss(css: string): string {
  return createHash('sha256').update(css).digest('hex').slice(0, 8)
}
