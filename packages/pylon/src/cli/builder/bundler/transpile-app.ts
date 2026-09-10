import {rolldown, type Plugin} from 'rolldown'
import {existsSync} from 'fs'
import fs from 'fs/promises'
import path from 'path'

/**
 * `pylon build`: transpile the app tree to `.pylon/**` for plain `node` (no loader, no
 * bundling). The catch: native ESM rejects extensionless relative imports
 * (`import './models'`), and a transpile must add `./models.js` / `./x/index.js`.
 *
 * We do this the esbuild-native way: `bundle:true` (so `onResolve` fires for every import)
 * with a plugin that marks each RELATIVE import `external` — keeping it as an import, not
 * inlining it — while rewriting its specifier to the extensioned form. Driven by esbuild's
 * parser, it covers every import shape (static, side-effect, dynamic, re-export); bare
 * (package) imports stay external too (`packages:'external'`) and Node resolves them from
 * `.pylon/**` up to `cwd/node_modules`. Net effect: a 1:1 transpiled mirror, no chunks.
 *
 * NOTE: scope is `src/**` + `pylon.config` (the server import graph in practice). A server
 * module importing source OUTSIDE `src/` would need the real import graph — flagged here.
 */

const SRC_EXTS = ['.ts', '.tsx', '.mts', '.cts']
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

async function walk(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  let entries: import('fs').Dirent[]
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

/** Keep relative imports as EXTERNAL (don't inline), rewritten to native-ESM specifiers:
 *  `./x` → `./x.js` (file) or `./x/index.js` (dir). Resolved against the importer dir, so
 *  file-vs-dir is decided correctly. The output mirrors the source tree, so the same
 *  relative path + extension is valid at runtime. */
const preserveRelativeWithExt: Plugin = {
  name: 'preserve-relative-with-ext',
  resolveId(source, importer) {
    if (!importer) return null // entry point — the files we're emitting
    if (!/^\.\.?(\/|$)/.test(source)) return null // bare → handled by `external` below
    // Let rolldown INLINE JSON (its default) instead of mirroring it as an external import:
    // a bare/relative `import x from './x.json'` kept external needs the `with { type: 'json' }`
    // attribute Node's strict ESM loader now demands, which the app source rarely writes — so an
    // externalized `.json` crashes at runtime (`ERR_IMPORT_ATTRIBUTE_MISSING`). Inlining keeps
    // the output runtime-agnostic (no attribute, no loose file) — the bundler's job, not a
    // per-runtime loader hook's.
    if (/\.json$/.test(source)) return null
    if (/\.(js|mjs|cjs|node)$/.test(source)) return {id: source, external: true}
    const abs = path.resolve(path.dirname(importer), source)
    let rewritten: string
    if (RESOLVE_EXTS.some(x => existsSync(abs + x))) rewritten = `${source}.js`
    else if (RESOLVE_EXTS.some(x => existsSync(path.join(abs, `index${x}`))))
      rewritten = `${source.replace(/\/$/, '')}/index.js`
    else rewritten = `${source}.js` // best-effort: treat as a file
    return {id: rewritten, external: true}
  }
}

export interface TranspileAppInput {
  cwd: string
  srcDir: string // <cwd>/src
  entryAbs: string // <cwd>/src/index.ts
  configAbs: string | null
  outDir: string // <cwd>/.pylon
}

export async function transpileApp(
  input: TranspileAppInput
): Promise<{entryOut: string; configOut: string | null}> {
  const {cwd, srcDir, entryAbs, configAbs, outDir} = input

  const entryPoints = await walk(srcDir, n => SRC_EXTS.some(x => n.endsWith(x)))
  if (configAbs && !entryPoints.includes(configAbs)) entryPoints.push(configAbs)

  // Input as an object keyed by the cwd-relative path (no ext) → mirrors the tree
  // under `.pylon/**` via entryFileNames (the rolldown equivalent of `outbase: cwd`).
  const inputMap = Object.fromEntries(
    entryPoints.map(abs => [
      path.relative(cwd, abs).replace(/\.(tsx?|mts|cts)$/, ''),
      abs
    ])
  )

  const bundle = await rolldown({
    input: inputMap,
    // packages:'external' equivalent — every bare specifier stays external; relative
    // ones are externalized+rewritten by the plugin above. Net: a 1:1 transpiled mirror.
    // EXCEPT `.json`: let rolldown resolve + inline it (a bare `pkg/x.json` import kept
    // external would crash under Node's strict ESM loader — see the plugin above).
    external: id =>
      !/\.json(\?|$)/.test(id) && !/^\.\.?(\/|$)/.test(id) && !path.isAbsolute(id),
    platform: 'node',
    // Read the project's tsconfig so oxc applies `useDefineForClassFields: false` — the
    // ORM field-builder `id = id()` must lower to a constructor assignment, not a
    // class-field define. The ORM is decorator-free, so no experimentalDecorators.
    tsconfig: true,
    transform: {target: 'node18'},
    plugins: [preserveRelativeWithExt]
  })
  await bundle.write({
    dir: outDir,
    format: 'esm',
    entryFileNames: '[name].js',
    sourcemap: 'inline'
  })
  await bundle.close()

  const toOut = (abs: string) =>
    path.join(outDir, path.relative(cwd, abs)).replace(/\.(tsx?|mts|cts|mjs|cjs|js)$/, '.js')

  return {entryOut: toOut(entryAbs), configOut: configAbs ? toOut(configAbs) : null}
}
