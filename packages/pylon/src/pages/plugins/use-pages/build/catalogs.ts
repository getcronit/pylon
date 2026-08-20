import fs from 'node:fs'
import path from 'node:path'
import {rolldown} from 'rolldown'

/** Extensions a catalog may be authored in. `.ts` is required for the DEFAULT locale. */
const CATALOG_EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'] as const

/** Where the built catalogs land, relative to the app root. */
export const CATALOG_OUT_DIR = path.join('.pylon', 'messages')

/** Resolve `<dir>/<locale>.<ext>` for the first extension that exists. */
export const findCatalogFile = (
  cwd: string,
  dir: string,
  locale: string
): string | undefined => {
  const base = path.resolve(cwd, dir, locale)
  for (const ext of CATALOG_EXTS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  return undefined
}

/**
 * Compile each locale's catalog into `.pylon/messages/<locale>.js`.
 *
 * This is why `catalogs` is a configured PATH rather than objects imported in
 * `pylon.config.ts`: only `src/**` is transpiled into `.pylon/`, so a catalog imported from
 * the config — statically OR dynamically — resolves at runtime to a `.pylon/messages/*.js`
 * that was never emitted, and the server dies with ERR_MODULE_NOT_FOUND. Owning the path
 * here means catalogs can live anywhere the app likes.
 *
 * Bundled, not merely transpiled, so a catalog may import helpers or a shared type module
 * without those needing to be emitted separately. JSON is inlined by rolldown natively.
 *
 * A missing catalog for a configured locale is a WARNING, not an error: the runtime falls
 * back to the default locale, so a half-translated site still serves.
 */
export const buildCatalogs = async (opts: {
  cwd: string
  dir: string
  locales: readonly string[]
  defaultLocale: string
}): Promise<void> => {
  const {cwd, dir, locales, defaultLocale} = opts
  const outDir = path.resolve(cwd, CATALOG_OUT_DIR)
  await fs.promises.mkdir(outDir, {recursive: true})

  for (const locale of locales) {
    const input = findCatalogFile(cwd, dir, locale)
    if (!input) {
      const where = path.join(dir, `${locale}.ts`)
      if (locale === defaultLocale) {
        // The default catalog is also the TYPE source, so its absence is worth saying loudly.
        console.warn(
          `[pylon] No catalog for the default locale '${locale}' (looked for ${where}). ` +
            `Translations fall back to it, and it is what \`Register\` types keys from.`
        )
      } else {
        console.warn(
          `[pylon] No catalog for locale '${locale}' (looked for ${where}); ` +
            `it will fall back to '${defaultLocale}'.`
        )
      }
      continue
    }

    const bundle = await rolldown({
      input: {[locale]: input},
      cwd,
      platform: 'node',
      transform: {target: 'es2022'}
    })
    await bundle.write({
      dir: outDir,
      format: 'esm',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      sourcemap: false,
      minify: false
    })
    await bundle.close()
  }
}
