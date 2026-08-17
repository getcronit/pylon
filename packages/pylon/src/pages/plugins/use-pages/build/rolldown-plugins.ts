import {createHash} from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import valueParser from 'postcss-value-parser'
import type {Plugin as RolldownPlugin} from 'rolldown'

/**
 * rolldown page-build plugins.
 *
 * rolldown 1.2.4 removed CSS bundling entirely — the moment a `.css` module
 * enters the graph the build hard-errors (UNSUPPORTED_FEATURE, see
 * rolldown#4271). So instead of letting rolldown see CSS, we intercept every
 * `.css` import in a `load` hook, run it through PostCSS ourselves, stash the
 * result out-of-band, and hand rolldown an empty JS module in its place. The
 * orchestrator then concatenates the collected CSS into a single hashed
 * `app.css` after the JS bundle is written.
 *
 * `url()` references inside CSS (fonts, background images) are resolved, copied
 * into the static assets dir, and rewritten to their public URL by the
 * `pylonCssAssets` PostCSS plugin (see `processCssFile`) — the CSS-aware step the
 * removed bundler used to do.
 */

const CSS_FILTER = /\.css$/
const IMAGE_FILTER = /\.(png|jpe?g)$/
const ASSET_FILTER = /\.(svg|woff2?|ttf|otf)$/

function shortHash(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

/** Where CSS-referenced assets are emitted and how they're addressed at runtime. */
export interface CssAssetOptions {
  /** Static output root; assets are written under `<outputDir>/assets/`. */
  outputDir: string
  /** Public URL prefix the CSS should reference assets by (e.g. `/__pylon/static`). */
  publicPath: string
}

/** url() refs we never rewrite: inline data, remote, or already-absolute URLs. */
function isExternalOrInlineUrl(ref: string): boolean {
  return (
    ref === '' ||
    ref.startsWith('data:') ||
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('//') ||
    ref.startsWith('/') || // already an absolute public URL
    ref.startsWith('#') // in-document fragment (e.g. an SVG mask/gradient ref)
  )
}

/**
 * PostCSS plugin: resolve relative `url()` refs, copy each asset to
 * `<outputDir>/assets/<name>-<hash><ext>`, and rewrite the url() to
 * `<publicPath>/assets/<name>-<hash><ext>` (preserving any `?query`/`#hash`).
 *
 * Runs LAST in the chain so it sees the final CSS after any `@import` inliner.
 * Resolution is inliner-agnostic: Tailwind v4 rebases url()s to be ENTRY-relative
 * yet keeps a node's `source` as the ORIGINAL file, while postcss-import keeps
 * url()s original-relative. So we try the node's source dir AND the entry dir and
 * use whichever candidate file actually exists (verified via build spikes).
 * Missing files are left untouched with a warning — never fail the build.
 */
function pylonCssAssets(opts: CssAssetOptions & {entryFile: string}) {
  const assetsDir = path.join(opts.outputDir, 'assets')
  const cache = new Map<string, string>() // resolved abs path -> public url (no suffix)

  const resolveExisting = async (
    ref: string,
    sourceFile: string
  ): Promise<string | null> => {
    const bases = [path.dirname(sourceFile), path.dirname(opts.entryFile)]
    for (const base of bases) {
      const abs = path.resolve(base, ref)
      try {
        await fs.access(abs)
        return abs
      } catch {
        /* try next base */
      }
    }
    return null
  }

  const emit = async (absPath: string): Promise<string> => {
    const cached = cache.get(absPath)
    if (cached) return cached
    const buf = await fs.readFile(absPath)
    const ext = path.extname(absPath)
    const outName = `${path.basename(absPath, ext)}-${shortHash(buf)}${ext}`
    await fs.mkdir(assetsDir, {recursive: true})
    await fs.writeFile(path.join(assetsDir, outName), buf)
    const url = `${opts.publicPath}/assets/${outName}`
    cache.set(absPath, url)
    return url
  }

  return {
    postcssPlugin: 'pylon-css-assets',
    async Declaration(decl: any) {
      if (!decl.value || !decl.value.includes('url(')) return
      const parsed = valueParser(decl.value)

      // Collect url() argument nodes synchronously (walk is sync), rewrite async.
      const args: any[] = []
      parsed.walk((node: any) => {
        if (node.type === 'function' && node.value.toLowerCase() === 'url') {
          const arg = node.nodes.find(
            (n: any) => n.type === 'string' || n.type === 'word'
          )
          if (arg) args.push(arg)
          return false // don't descend into the url()'s arguments
        }
        return undefined
      })

      let changed = false
      for (const arg of args) {
        const ref: string = arg.value
        if (isExternalOrInlineUrl(ref)) continue
        const marker = ref.search(/[?#]/)
        const pathPart = marker === -1 ? ref : ref.slice(0, marker)
        const suffix = marker === -1 ? '' : ref.slice(marker)
        const sourceFile = decl.source?.input?.file ?? opts.entryFile
        const abs = await resolveExisting(pathPart, sourceFile)
        if (!abs) {
          console.warn(
            `[Pylon] CSS asset not found: url(${ref}) (from ${sourceFile})`
          )
          continue
        }
        arg.value = (await emit(abs)) + suffix
        changed = true
      }
      if (changed) decl.value = parsed.toString()
    }
  }
}

/**
 * Run a CSS file through the project's PostCSS config (Tailwind etc.). Falls
 * back to the raw file contents when no PostCSS config is present — the old
 * esbuild plugin called `postcss-load-config` unconditionally and threw on
 * apps without a config; treating "no config" as "no transform" is strictly
 * more forgiving.
 */
export async function processCssFile(
  filePath: string,
  assetOpts?: CssAssetOptions
): Promise<string> {
  const css = await fs.readFile(filePath, 'utf8')

  let userPlugins: any[] = []
  let options: any = {}
  try {
    const loadConfig = (await import('postcss-load-config')).default
    const config = await loadConfig({}, path.dirname(filePath))
    userPlugins = (config.plugins as any[]) ?? []
    options = config.options ?? {}
  } catch {
    // No PostCSS config discoverable — run with just our asset plugin (if any).
  }

  const plugins = [...userPlugins]
  // Append LAST so it sees the CSS after the user's @import inliner (Tailwind).
  if (assetOpts) plugins.push(pylonCssAssets({...assetOpts, entryFile: filePath}))

  if (plugins.length === 0) return css // nothing to do — pass through untouched

  const postcss = (await import('postcss')).default
  const result = await postcss(plugins).process(css, {...options, from: filePath})
  return result.css
}

/**
 * Intercepts `.css` imports, PostCSS-processes them, records the output in
 * `collected` (insertion order ≈ import order), and replaces the module with an
 * empty JS export so it drops out of the JS graph without tripping rolldown's
 * removed-CSS-bundling error.
 */
export function cssCollectPlugin(
  collected: Map<string, string>,
  assetOpts?: CssAssetOptions
): RolldownPlugin {
  return {
    name: 'pylon-css-collect',
    load: {
      filter: {id: CSS_FILTER},
      async handler(id) {
        if (!collected.has(id)) {
          collected.set(id, await processCssFile(id, assetOpts))
        }
        return {code: 'export default {}', moduleType: 'js', map: null}
      }
    }
  }
}

/**
 * Emits a low-res WebP blur placeholder (via sharp) for imported PNG/JPEG files
 * and copies the original into `<mediaDir>`, returning a JSON module of
 * `{url, width, height, blurDataURL}` — matching the old esbuild image plugin.
 */
/**
 * Copy a source image verbatim into the media dir under its content-hashed name and
 * return the public URL — the SAME scheme `imagePlugin` uses. Shared so the dev SSR
 * (rolldown) and the dev client (Vite `pylonImageVite`) resolve a module-imported image
 * to the IDENTICAL URL — otherwise `<Image src={import}>` would hydration-mismatch (the
 * two toolchains would emit different `<img src>`). The `export default {url}` shape is
 * a subset of the prod object; `<Image>` handles the missing width/height/blur.
 */
export const IMAGE_FILTER_RE = IMAGE_FILTER
export async function emitDevImageUrl(
  id: string,
  mediaDir: string,
  publicPath: string
): Promise<string> {
  const buf = await fs.readFile(id)
  const ext = path.extname(id)
  const outName = `${path.basename(id)}-${shortHash(id + buf.toString('binary'))}${ext}`
  await fs.mkdir(mediaDir, {recursive: true})
  await fs.writeFile(path.join(mediaDir, outName), buf)
  return `${publicPath}/media/${outName}`
}

export function imagePlugin(opts: {
  mediaDir: string
  publicPath: string
  /** Dev: skip the sharp blur/optimize; emit just the URL so it matches the Vite client
   *  (no hydration mismatch). Prod stays full (blur + dimensions). */
  dev?: boolean
}): RolldownPlugin {
  return {
    name: 'pylon-image',
    load: {
      filter: {id: IMAGE_FILTER},
      async handler(id) {
        if (opts.dev) {
          const url = await emitDevImageUrl(id, opts.mediaDir, opts.publicPath)
          return {code: `export default ${JSON.stringify({url})}`, moduleType: 'js', map: null}
        }

        const sharp = (await import('sharp')).default
        const buf = await fs.readFile(id)

        const ext = path.extname(id)
        const hash = shortHash(id + buf.toString('binary'))
        const outName = `${path.basename(id)}-${hash}${ext}`
        const outPath = path.join(opts.mediaDir, outName)
        await fs.mkdir(opts.mediaDir, {recursive: true})
        await fs.writeFile(outPath, buf)

        const image = sharp(buf)
        const metadata = await image.metadata()
        const {data, info} = await image
          .resize({
            width: Math.min(metadata.width ?? 16, 16),
            height: Math.min(metadata.height ?? 16, 16),
            fit: 'inside'
          })
          .toFormat('webp', {quality: 30, alphaQuality: 20, smartSubsample: true})
          .toBuffer({resolveWithObject: true})

        const blurDataURL = `data:image/${info.format};base64,${data.toString(
          'base64'
        )}`

        return {
          code: `export default ${JSON.stringify({
            url: `${opts.publicPath}/media/${outName}`,
            width: metadata.width,
            height: metadata.height,
            blurDataURL
          })}`,
          moduleType: 'js',
          map: null
        }
      }
    }
  }
}

/**
 * Handles font/svg imports: emits the file as an asset and resolves the import
 * to its URL, prefixed with the public path via the `resolveFileUrl` hook so the
 * browser fetches it from the served static mount.
 */
export function assetFilePlugin(publicPath: string): RolldownPlugin {
  return {
    name: 'pylon-asset-file',
    resolveFileUrl({fileName}) {
      return JSON.stringify(`${publicPath}/${fileName}`)
    },
    load: {
      filter: {id: ASSET_FILTER},
      async handler(id) {
        const source = await fs.readFile(id)
        const ref = this.emitFile({
          type: 'asset',
          name: path.basename(id),
          source
        })
        return {
          code: `export default import.meta.ROLLUP_FILE_URL_${ref}`,
          moduleType: 'js',
          map: null
        }
      }
    }
  }
}

/**
 * Appends the client hydration bootstrap to the generated `.pylon/app.tsx`.
 * Client build only.
 *
 * Sentry is opt-in: `@sentry/react` is only imported (and wired into the
 * hydrateRoot error callbacks) when the consumer app declares it as a dependency
 * (`sentryEnabled`). Otherwise a plain console-based uncaught-error handler is
 * used, so apps without Sentry don't need it installed.
 */
export function injectAppHydrationPlugin(
  version: string,
  appTsxAbs: string,
  sentryEnabled: boolean
): RolldownPlugin {
  const sentryImport = sentryEnabled
    ? `import * as Sentry from '@sentry/react'`
    : ''

  const hydrateOptions = sentryEnabled
    ? `{
                // Callback called when an error is thrown and not caught by an ErrorBoundary.
                onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
                  console.warn('Uncaught error', error, errorInfo.componentStack);
                }),
                // Callback called when React catches an error in an ErrorBoundary.
                onCaughtError: Sentry.reactErrorHandler(),
                // Callback called when React automatically recovers from errors.
                onRecoverableError: Sentry.reactErrorHandler(),
              }`
    : `{
                // Callback called when an error is thrown and not caught by an ErrorBoundary.
                onUncaughtError: (error, errorInfo) => {
                  console.warn('Uncaught error', error, errorInfo.componentStack);
                },
              }`

  return {
    name: 'pylon-inject-hydration',
    load: {
      filter: {id: /app\.tsx$/},
      async handler(id) {
        if (path.resolve(id) !== appTsxAbs) return null

        let contents = await fs.readFile(id, 'utf8')

        const clientPath = path.resolve(process.cwd(), '.pylon/client')
        const pathToClient = path.relative(path.dirname(id), clientPath)

        contents += `
          import {hydrateRoot} from 'react-dom/client'
          import * as client from './${pathToClient}'
          // NOTE: __PYLON_ROUTER_INTERNALS_DO_NOT_USE and __PYLON_INTERNALS_DO_NOT_USE
          // are already imported at the top of the generated app.tsx (see
          // app-utils.ts \`generateRouteFileContent\`), so we do NOT re-import them
          // here — rolldown/oxc rejects re-importing the same binding (esbuild used
          // to silently merge duplicate imports; rolldown is spec-strict).
          import React, {startTransition} from 'react'
          ${sentryImport}

          // @ts-ignore
          window.__PYLON_VERSION__ = "${version}"
          async function hydrate() {
            // Determine if any of the initial routes are lazy
            const lazyMatches = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.matchRoutes(routes, window.location)?.filter(
              (m) => m.route.lazy
            );

            // Load the lazy matches and update the routes before creating your router
            // so we can hydrate the SSR-rendered content synchronously
            if (lazyMatches && lazyMatches?.length > 0) {
              await Promise.all(
                lazyMatches.map(async (m) => {
                  const routeModule = await m.route.lazy!();
                  Object.assign(m.route, { ...routeModule, lazy: undefined });
                })
              );
            }

            // Operation-keyed hydration: seed the pylon-query store from the
            // flat { opKey: result } map the server embedded under
            // window.__pylonStaticData.cache.
            const payload = (window as any).__pylonStaticData?.cache
            if (payload) {
              const coreClient = (client as any).client || client
              if (coreClient && typeof coreClient.hydrate === 'function') {
                coreClient.hydrate(payload)
              }
            }

            // @ts-ignore
            const router = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.createBrowserRouter(routes)

            // @ts-ignore
            window.__PYLON_NAVIGATE__ = router.navigate

            startTransition(() => {
              hydrateRoot(
                document,
                  <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider client={client}>
                    <__PYLON_ROUTER_INTERNALS_DO_NOT_USE.RouterProvider router={router} />
                  </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
              , ${hydrateOptions})
            })
         }

         hydrate()


          `

        return {code: contents, moduleType: 'tsx', map: null}
      }
    }
  }
}
