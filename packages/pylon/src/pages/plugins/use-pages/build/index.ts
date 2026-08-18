import {Plugin} from '@getcronit/pylon'
import {createHash} from 'crypto'
import fs from 'fs/promises'
import {createRequire} from 'module'
import path from 'path'
import {rolldown, type RolldownOutput} from 'rolldown'

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
const NON_JS_ASSET = /\.(css|scss|sass|less|styl|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|otf)$/i

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
    if (current.equals(newContent)) return false
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
      // Clean the hashed-output dirs first: rolldown's content hashes change with
      // every edit, so without this old bundles/CSS/chunks accumulate unbounded
      // across dev rebuilds. `public` lives in a sibling dir and is untouched.
      await Promise.all([
        fs.rm(DIST_STATIC_DIR, {recursive: true, force: true}),
        fs.rm(DIST_PAGES_DIR, {recursive: true, force: true})
      ])
      await buildAppFile()
      await copyPublicDir()
      if (process.env.PYLON_DEV) {
        // Dev: Vite serves the client, so the rolldown client JS bundle is dead weight.
        // Skip it — the server build traverses the same graph and now writes the CSS
        // (the SSR precedence `<link>`s), so one build does it all.
        const collectedCss = await runServerBuild(true)
        await writeDevStaticManifest(collectedCss)
      } else {
        await Promise.all([runClientBuild(), runServerBuild()])
      }
    },
    cancel: async () => {}
  }
}

function hashCss(css: string): string {
  return createHash('sha256').update(css).digest('hex').slice(0, 8)
}
