import type {Context, Plugin} from '@getcronit/pylon'

/**
 * Populate `pagesContext` — the request-scoped value every page, layout and
 * `useRouteData()` consumer sees as `PageProps.context`.
 *
 * This is the read channel into an SSR render: the `usePages` catch-all reads
 * `c.get('pagesContext')` before rendering and serialises it into
 * `window.__pylonStaticData.context`, so the browser hydrates with the IDENTICAL value.
 * That is what makes cookie-driven theme, sidebar state or locale flash-free — the value is
 * in the first byte of HTML, not applied after mount.
 *
 * ```ts
 * // pylon.config.ts
 * import {getCookie, useNodeServer, type PylonConfig} from '@getcronit/pylon'
 * import {usePages, useRequestContext} from '@getcronit/pylon/pages/plugin'
 *
 * export default {
 *   plugins: [
 *     useRequestContext(c => ({
 *       theme: getCookie(c, 'theme') ?? 'system',
 *       sidebarOpen: getCookie(c, 'sidebar') !== 'closed'
 *     }), {vary: ['Cookie']}),
 *     usePages(),
 *     useNodeServer()
 *   ]
 * } satisfies PylonConfig
 * ```
 *
 * Declare the shape by augmenting `Variables` (see `PagesContext`); undeclared it is
 * `unknown`.
 *
 * Ordering is the reason this is a plugin rather than a documented snippet: it must run
 * BEFORE the `usePages` catch-all, which is a `'last'`-strategy plugin. This helper is
 * `'first'`, so that holds without the app knowing about it.
 *
 * See rfcs/SSR_REQUEST_CONTEXT.md.
 */
export interface RequestContextOptions {
  /**
   * Response headers to add to `Vary`, e.g. `['Cookie']` or
   * `['Cookie', 'Accept-Language']`.
   *
   * NOT inferred — we cannot see which headers the factory read — so it is explicit and
   * additive (existing `Vary` entries are preserved, duplicates are not added). Nothing
   * caches SSR HTML inside the framework today, so this is latent rather than load-bearing;
   * it matters the moment a CDN sits in front of a context-varying app.
   */
  vary?: string[]
}

/** Add `value` to a `Vary` header without duplicating an existing entry. */
const appendVary = (headers: Headers, value: string): void => {
  const current = headers.get('Vary')
  if (!current) {
    headers.set('Vary', value)
    return
  }
  if (current.trim() === '*') return // already the broadest possible
  const present = current
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
  if (present.includes(value.toLowerCase())) return
  headers.set('Vary', `${current}, ${value}`)
}

export function useRequestContext<T>(
  factory: (c: Context) => T | Promise<T>,
  options: RequestContextOptions = {}
): Plugin {
  const vary = options.vary ?? []

  return {
    name: 'request-context',
    // 'first' — before the GraphQL handler and before the usePages catch-all ('last'),
    // so the value is present by the time SSR reads it.
    strategy: 'first',
    setup: app => {
      app.use('*', async (c, next) => {
        c.set('pagesContext' as never, (await factory(c)) as never)
        await next()
        // After `next()`: the downstream response exists, so its headers are the ones the
        // client will see. The SSR render is fully buffered before `c.html(...)`, which is
        // why mutating headers here is safe rather than a race.
        for (const header of vary) appendVary(c.res.headers, header)
      })
    }
  }
}
