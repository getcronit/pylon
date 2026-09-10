import {existsSync} from 'fs'
import fs from 'fs/promises'
import path from 'path'
import loadConfig from 'postcss-load-config'
import postcss from 'postcss'
import {rolldown} from 'rolldown'
import {fileURLToPath} from 'url'

/**
 * Build the fat @getcronit/pylon package — TRANSPILE-ONLY, no bundling.
 *
 * Every `src/**` module is transpiled 1:1 to `dist/**` (mirroring the tree), with
 * imports kept as real ESM imports:
 *   • bare specifiers (deps + `@getcronit/pylon/<feature>` self-refs) stay
 *     EXTERNAL — resolved at runtime via node_modules / the exports map, so `db`
 *     isn't duplicated into `pages`, singletons stay single;
 *   • relative imports are externalized too and rewritten to native-ESM
 *     specifiers (`./x` → `./x.js`, `./dir` → `./dir/index.js`);
 *   • the `@/*` path alias is rewritten to the equivalent relative specifier.
 *
 * Why transpile-only instead of bundling: a library shouldn't bundle itself, and
 * bundling `core` is exactly what made the old esbuild build leak a `node:module`
 * `createRequire` shim into browser entries (oxc injects CJS interop at the CHUNK
 * level). No chunks → no shim → browser entries stay clean. It also preserves the
 * model-registry singleton (one shared `./registry.js` file) and the CLI sibling
 * layout (`project-runner.js` next to `index.js`) for free, without `splitting`.
 *
 * CSS: side-effect `import './x.css'` statements are stripped from the JS (the
 * framework ships its stylesheet as the `./pages/index.css` export + injects it
 * via <link>, not through JS), and `src/pages/globals.css` is run through the
 * package's PostCSS (Tailwind) into `dist/pages/index.css`.
 *
 * `.d.ts` declarations are emitted separately by `build:declarations` (tsc).
 */

const pkgDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(pkgDir, 'src')
const outDir = path.join(pkgDir, 'dist')

const SRC_EXTS = ['.ts', '.tsx']
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const isRelative = s => /^\.\.?(\/|$)/.test(s)

async function walk(dir, match) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, {withFileTypes: true})
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, match)))
    else if (match(e.name)) out.push(p)
  }
  return out
}

/** Rewrite a relative/alias specifier to its native-ESM form (file vs dir index). */
function withExt(spec, absNoExt) {
  if (/\.(js|mjs|cjs|json|node|css)$/.test(spec)) return spec
  if (RESOLVE_EXTS.some(x => existsSync(absNoExt + x))) return `${spec}.js`
  if (RESOLVE_EXTS.some(x => existsSync(path.join(absNoExt, `index${x}`))))
    return `${spec.replace(/\/$/, '')}/index.js`
  return `${spec}.js` // best-effort: treat as a file
}

/** Keep relative + `@/` imports EXTERNAL (don't inline), rewritten to real paths. */
const rewriteImports = {
  name: 'rewrite-imports',
  resolveId(source, importer) {
    if (!importer) return null // entry — the files we're emitting
    if (source.startsWith('@/')) {
      const targetAbs = path.join(srcDir, source.slice(2))
      let rel = path.relative(path.dirname(importer), targetAbs)
      if (!rel.startsWith('.')) rel = `./${rel}`
      return {id: withExt(rel.split(path.sep).join('/'), targetAbs), external: true}
    }
    if (!isRelative(source)) return null // bare → handled by `external` below
    // Let rolldown natively load+inline JSON (its own `json` module type) — Node
    // can't `import x from './y.json'` without an import attribute, so unlike .ts
    // these must be inlined, not kept as external imports (esbuild did the same).
    if (source.endsWith('.json')) return null
    const abs = path.resolve(path.dirname(importer), source)
    return {id: withExt(source, abs), external: true}
  }
}

/** Strip side-effect CSS imports (`import './x.css'`) — see header. */
const stripCssImports = {
  name: 'strip-css-imports',
  transform(code, id) {
    if (!/\.(tsx?|mts|cts)$/.test(id) || !code.includes('.css')) return null
    const stripped = code.replace(
      /^[ \t]*import\s+['"][^'"]+\.css['"];?[ \t]*\r?\n/gm,
      ''
    )
    return stripped === code ? null : {code: stripped, map: null}
  }
}

async function transpile() {
  const entryPoints = (
    await walk(srcDir, n => SRC_EXTS.some(x => n.endsWith(x)))
  ).filter(p => !/\.(test|spec|bench)\.(ts|tsx)$/.test(p))

  // Input keyed by the src-relative path (no ext) → mirrors the tree under dist/
  // via entryFileNames (the equivalent of esbuild's `outbase: 'src'`).
  const inputMap = Object.fromEntries(
    entryPoints.map(abs => [
      path.relative(srcDir, abs).replace(/\.(tsx?|mts|cts)$/, ''),
      abs
    ])
  )

  const bundle = await rolldown({
    input: inputMap,
    cwd: pkgDir,
    // Every bare specifier stays external; relative + `@/` are externalized and
    // rewritten by the plugin. Net effect: a 1:1 transpiled mirror, no chunks.
    // EXCEPTION: oxc lowers some syntax (e.g. tagged templates) to helpers it
    // imports from `@oxc-project/runtime`. We INLINE those (don't externalize) so
    // the published package carries no dependency on that fast-moving oxc-internal
    // 0.x package — the tiny helper is bundled into the one file that uses it.
    external: id =>
      !isRelative(id) &&
      !path.isAbsolute(id) &&
      !id.startsWith('@/') &&
      !id.startsWith('@oxc-project/runtime'),
    platform: 'neutral',
    // Read the package tsconfig so oxc matches the shipped compile settings.
    tsconfig: path.join(pkgDir, 'tsconfig.json'),
    transform: {target: 'es2022', jsx: 'react-jsx'},
    plugins: [stripCssImports, rewriteImports]
  })
  await bundle.write({
    dir: outDir,
    format: 'esm',
    entryFileNames: '[name].js',
    sourcemap: true,
    minify: false
  })
  await bundle.close()
  return entryPoints.length
}

async function buildFrameworkStylesheet() {
  const cssSrc = path.join(srcDir, 'pages', 'globals.css')
  const {plugins, options} = await loadConfig({}, pkgDir)
  const css = await fs.readFile(cssSrc, 'utf8')
  const result = await postcss(plugins).process(css, {...options, from: cssSrc})
  await fs.mkdir(path.join(outDir, 'pages'), {recursive: true})
  await fs.writeFile(path.join(outDir, 'pages', 'index.css'), result.css)
}

const start = Date.now()
const [count] = await Promise.all([transpile(), buildFrameworkStylesheet()])
console.log(
  `[pylon] transpiled ${count} modules + framework stylesheet in ${
    Date.now() - start
  }ms`
)
