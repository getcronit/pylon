import {createHash} from 'crypto'
import fs from 'fs/promises'
import path from 'path'
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
 * Known limitation vs the old esbuild pipeline: `url()` references inside CSS
 * are NOT resolved/copied (there's no CSS-aware bundler to walk them). Tailwind
 * v4 output doesn't emit local `url()`s, so this is a no-op for the common case;
 * apps with `@font-face { src: url('./local.woff') }` would need those assets
 * copied manually. Revisit if/when rolldown restores CSS support.
 */

const CSS_FILTER = /\.css$/
const IMAGE_FILTER = /\.(png|jpe?g)$/
const ASSET_FILTER = /\.(svg|woff2?|ttf|otf)$/

function shortHash(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

/**
 * Run a CSS file through the project's PostCSS config (Tailwind etc.). Falls
 * back to the raw file contents when no PostCSS config is present — the old
 * esbuild plugin called `postcss-load-config` unconditionally and threw on
 * apps without a config; treating "no config" as "no transform" is strictly
 * more forgiving.
 */
export async function processCssFile(filePath: string): Promise<string> {
  const css = await fs.readFile(filePath, 'utf8')

  let plugins: any[] | undefined
  let options: any
  try {
    const loadConfig = (await import('postcss-load-config')).default
    const config = await loadConfig({}, path.dirname(filePath))
    plugins = config.plugins as any[]
    options = config.options
  } catch {
    // No PostCSS config discoverable — pass the CSS through untouched.
    return css
  }

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
  collected: Map<string, string>
): RolldownPlugin {
  return {
    name: 'pylon-css-collect',
    load: {
      filter: {id: CSS_FILTER},
      async handler(id) {
        if (!collected.has(id)) {
          collected.set(id, await processCssFile(id))
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
export function imagePlugin(opts: {
  mediaDir: string
  publicPath: string
}): RolldownPlugin {
  return {
    name: 'pylon-image',
    load: {
      filter: {id: IMAGE_FILTER},
      async handler(id) {
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
${
  process.env.PYLON_DEV_RELOAD_PORT
    ? `
          // Pylon dev live-reload (Tier 0): subscribe to the dev CLI's SSE server
          // and hard-reload on a pushed event. Only injected in dev (the env var is
          // set by \`pylon dev\`); absent in production builds.
          try {
            var __pylonReloadES = new EventSource(
              location.protocol + "//" + location.hostname + ":${process.env.PYLON_DEV_RELOAD_PORT}/__pylon_reload"
            )
            __pylonReloadES.addEventListener("reload", function () {
              location.reload()
            })
          } catch (e) {}
`
    : ''
}
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
