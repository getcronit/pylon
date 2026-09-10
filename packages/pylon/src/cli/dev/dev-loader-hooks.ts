/**
 * Node module-customization hooks for `pylon dev`.
 *
 * The dev runner externalizes ALL node_modules (see vite-hot-server.ts) so they load natively
 * through Node, not Vite's SSR transform. That's correct — but it leaves two gaps a dependency
 * can trip on at runtime, because the externalized imports go through Node's ESM loader:
 *
 *   • JSON — Node requires an explicit `with { type: 'json' }` attribute. A CJS package doing a
 *     bare `require('./x.json')` (e.g. i18n-iso-countries' `langs/*.json`), routed through the
 *     loader chain, throws `ERR_IMPORT_ATTRIBUTE_MISSING`. The resolve hook stamps `type: 'json'`
 *     on every `.json` URL so those loads succeed without the call site providing the attribute.
 *
 *   • CSS/style assets — a server-side `import 'pkg/x.css'` is meaningless for SSR (styles ship
 *     via the client build's css plugin), and Node can't load `.css` at all. The load hook
 *     returns an empty module so the import is a harmless no-op instead of a crash.
 *
 * This file is a standalone hooks module (no pylon imports — it runs in Node's separate hooks
 * thread) registered via `module.register` in dev-server.ts before the app boots.
 */

export async function resolve(
  specifier: string,
  context: unknown,
  nextResolve: (s: string, c: unknown) => Promise<{url?: string; importAttributes?: Record<string, string>}>
) {
  const result = await nextResolve(specifier, context)
  if (typeof result.url === 'string' && result.url.split('?')[0].endsWith('.json')) {
    return {...result, importAttributes: {...(result.importAttributes ?? {}), type: 'json'}}
  }
  return result
}

const STYLE_ASSET = /\.(css|scss|sass|less|styl)(\?|$)/

export async function load(
  url: string,
  context: unknown,
  nextLoad: (u: string, c: unknown) => Promise<unknown>
) {
  if (STYLE_ASSET.test(url)) {
    return {format: 'module', source: 'export default {}', shortCircuit: true}
  }
  return nextLoad(url, context)
}
