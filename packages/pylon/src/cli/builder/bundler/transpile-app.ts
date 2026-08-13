import esbuild from 'esbuild'
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
const preserveRelativeWithExt: esbuild.Plugin = {
  name: 'preserve-relative-with-ext',
  setup(build) {
    build.onResolve({filter: /^\.\.?(\/|$)/}, args => {
      if (args.kind === 'entry-point') return // the files we're emitting
      const spec = args.path
      if (/\.(js|mjs|cjs|json|node)$/.test(spec)) return {path: spec, external: true}
      const abs = path.resolve(args.resolveDir, spec)
      let rewritten: string
      if (RESOLVE_EXTS.some(x => existsSync(abs + x))) rewritten = `${spec}.js`
      else if (RESOLVE_EXTS.some(x => existsSync(path.join(abs, `index${x}`))))
        rewritten = `${spec.replace(/\/$/, '')}/index.js`
      else rewritten = `${spec}.js` // best-effort: treat as a file
      return {path: rewritten, external: true}
    })
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

  await esbuild.build({
    entryPoints,
    outbase: cwd, // mirror under `.pylon/src/…` + `.pylon/pylon.config.js`
    outdir: outDir,
    bundle: true, // needed for onResolve to fire; the plugin externalizes everything
    packages: 'external',
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
    target: 'node18',
    logLevel: 'silent',
    plugins: [preserveRelativeWithExt],
    // `useDefineForClassFields: false` keeps field-builder initializers (`id = id()`)
    // running as assignments the model proxy can harvest — NOT hoisted `defineProperty`
    // slots. The ORM is decorator-free, so no `experimentalDecorators` is needed.
    tsconfigRaw: {
      compilerOptions: {useDefineForClassFields: false}
    }
  })

  const toOut = (abs: string) =>
    path.join(outDir, path.relative(cwd, abs)).replace(/\.(tsx?|mts|cts|mjs|cjs|js)$/, '.js')

  return {entryOut: toOut(entryAbs), configOut: configAbs ? toOut(configAbs) : null}
}
