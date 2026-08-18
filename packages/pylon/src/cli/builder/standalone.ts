/**
 * Standalone deploy tracer (Workstream D — `pylon build --standalone`).
 *
 * After a normal build (`.pylon/**` emitted), trace the REAL runtime file graph of
 * `.pylon/server.mjs` with `@vercel/nft` and copy just those files — app + the exact
 * subset of `node_modules` it touches — into `.pylon/standalone/`. The result runs with
 * plain `node <entry>` and NO `npm install`, so it drops into a scratch/distroless image.
 *
 * Why trace instead of bundle: three things break under a single-file bundle but survive a
 * file copy — `sharp`'s native `.node` binaries, usePages' content-hashed SSR route chunks
 * loaded via runtime `import()`, and the unbundled transpile-only app. So:
 *   - nft gives the STATIC graph (server.mjs → framework → transpiled app → their deps).
 *   - Non-literal / dynamic imports nft can't see get added as explicit trace roots
 *     (@hono/node-server via useNodeServer, sharp + its native @img/sharp-* packages).
 *   - The app's own `.pylon/**` is copied wholesale so the dynamic page chunks/manifests
 *     are present regardless of how they're imported.
 *
 * Symlinks are PRESERVED (not dereferenced) so a pnpm `node_modules/<pkg> → .pnpm/…` layout
 * stays resolvable in the copy. The trace base is the topmost ancestor holding a
 * `node_modules` (the workspace root in a monorepo, else cwd) so no traced path escapes the
 * output — mirroring Next.js `output: 'standalone'`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'

export interface StandaloneResult {
  /** Absolute path to the standalone output dir. */
  outDir: string
  /** The app's base-relative location inside the output (`<output>` for a lone app,
   *  `<output>/<pkg-path>` in a monorepo) — where `.pylon` lives. */
  runDir: string
  /** Absolute path to the generated launcher — run it from ANY cwd (`node <launcher>`). */
  launcher: string
  /** Absolute path to the server entry itself (the launcher imports it; also runnable
   *  directly — server.mjs is cwd-independent). */
  entry: string
  /** Number of files copied. */
  fileCount: number
  /** Total bytes copied. */
  byteCount: number
  /** nft warnings (unresolved dynamic requires) — surfaced but non-fatal. */
  warnings: string[]
}

/** Collect files under `dir` (recursively) whose name ends with one of `exts`. */
function collectFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...collectFiles(p, exts))
    else if (exts.some(e => ent.name.endsWith(e))) out.push(p)
  }
  return out
}

/** Topmost ancestor of `cwd` that contains a `node_modules` (workspace root), else `cwd`. */
function detectBase(cwd: string): string {
  let base = cwd
  let d = cwd
  for (;;) {
    const parent = path.dirname(d)
    if (parent === d) break
    if (fs.existsSync(path.join(parent, 'node_modules'))) base = parent
    d = parent
  }
  return base
}

/** Resolve an optional dependency's entry from the app, or null if it isn't installed. */
function tryResolve(req: NodeRequire, spec: string): string | null {
  try {
    return req.resolve(spec)
  } catch {
    return null
  }
}

/** Copy one traced path, PRESERVING symlinks (pnpm's node_modules layout depends on them). */
async function copyEntry(srcAbs: string, destAbs: string): Promise<number> {
  const st = await fs.promises.lstat(srcAbs).catch(() => null)
  if (!st) return 0
  await fs.promises.mkdir(path.dirname(destAbs), {recursive: true})
  if (st.isSymbolicLink()) {
    const target = await fs.promises.readlink(srcAbs)
    // Recreate the (usually relative) link; ignore if a prior entry already made it.
    await fs.promises.symlink(target, destAbs).catch((e: any) => {
      if (e?.code !== 'EEXIST') throw e
    })
    return 0
  }
  if (st.isDirectory()) {
    await fs.promises.mkdir(destAbs, {recursive: true})
    return 0
  }
  await fs.promises.copyFile(srcAbs, destAbs)
  return st.size
}

/** Recursively copy a directory (files + symlinks), skipping `skipDir`. */
async function copyTree(srcDir: string, destDir: string, skipDir: string): Promise<{files: number; bytes: number}> {
  let files = 0
  let bytes = 0
  const entries = await fs.promises.readdir(srcDir, {withFileTypes: true})
  for (const ent of entries) {
    const srcAbs = path.join(srcDir, ent.name)
    if (path.resolve(srcAbs) === path.resolve(skipDir)) continue
    const destAbs = path.join(destDir, ent.name)
    if (ent.isDirectory()) {
      const sub = await copyTree(srcAbs, destAbs, skipDir)
      files += sub.files
      bytes += sub.bytes
    } else {
      const n = await copyEntry(srcAbs, destAbs)
      files += 1
      bytes += n
    }
  }
  return {files, bytes}
}

export async function buildStandalone(opts: {
  cwd: string
  /** Absolute `.pylon` output dir. */
  outDir: string
  /** Extra project-relative files/dirs to copy alongside the app (e.g. `content` that the
   *  app reads at runtime). nft traces imported CODE, not data read via `fs`, so anything the
   *  app opens at runtime must be declared here. Copied to the app dir inside the output. */
  include?: string[]
}): Promise<StandaloneResult> {
  const {cwd, outDir, include = []} = opts
  const serverEntry = path.join(outDir, 'server.mjs')
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `standalone: ${serverEntry} not found — run the build before tracing (this is an internal ordering bug).`
    )
  }

  // nft resolves package `exports` per its OWN Node version; module-sync-only ESM entries need
  // a Node ≥22 builder (see the trace note below). Warn early so a broken artifact is explained.
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 22) {
    console.warn(
      `[pylon] standalone: tracing on Node ${process.versions.node}. Build on Node ≥22 — nft ` +
        `only auto-selects the \`module-sync\` export condition there, so some ESM-only packages ` +
        `(e.g. react-router) can otherwise be traced as CJS → ERR_MODULE_NOT_FOUND at runtime.`
    )
  }

  const standaloneDir = path.join(outDir, 'standalone')
  await fs.promises.rm(standaloneDir, {recursive: true, force: true})

  const base = detectBase(cwd)
  const req = createRequire(path.join(cwd, 'package.json'))

  // Explicit trace roots: deps reached via NON-LITERAL / dynamic import that nft's static
  // analysis can't see. @hono/node-server is imported as `const s='@hono/node-server'` in
  // useNodeServer; sharp (+ its native platform packages) is optional image tooling.
  const roots = [serverEntry]
  const hono = tryResolve(req, '@hono/node-server')
  if (hono) roots.push(hono)
  const sharp = tryResolve(req, 'sharp')
  if (sharp) roots.push(sharp)
  // usePages SSR route chunks (`.pylon/__pylon/pages/*.js`) are loaded via runtime
  // `import()` — invisible to nft's static analysis — so trace them explicitly, else their
  // imports (react, react-dom/server, the app's components) get dropped from node_modules.
  roots.push(...collectFiles(path.join(outDir, '__pylon', 'pages'), ['.js', '.mjs']))

  // Heavy, dev/build-only dep loaded lazily (mirrors the bundler's tsx/esm pattern) — keeps
  // its types out of tsc and keeps it out of any graph traced for the shipped app.
  const nftMod = '@vercel/nft'
  const {nodeFileTrace} = (await import(nftMod)) as {
    nodeFileTrace: (
      files: string[],
      opts?: {base?: string; ignore?: string[]}
    ) => Promise<{fileList: Set<string>; warnings: Set<Error>}>
  }

  // Every plugin `build` hook (usePages today, any added later) lazily `import('./build')` its
  // pipeline — build-time only, never loaded at serve. But nft follows literal dynamic imports
  // (and the transpiler constant-folds a variable specifier straight back to a literal), so the
  // whole build TOOLCHAIN (postcss-load-config → tsx → esbuild ≈67 MB, rolldown, ts-morph) gets
  // traced into the SERVE artifact. Excluding one plugin's build FOLDER by name is fragile —
  // it breaks when the code moves and misses other plugins. Instead exclude EVERY `build/` dir
  // under the framework's own dist: it's plugin-agnostic and refactor-resilient (any plugin's
  // build code, wherever it sits, as long as it lives in a `build/` dir), and that code is
  // never loaded at serve. Cuts the toolchain out entirely (~half the artifact).
  const ignore = ['**/pylon/dist/**/build/**']

  // NOTE on Node version: nft resolves package `exports` per-edge (import vs require), so dual
  // packages land on the right build — EXCEPT it only auto-selects the `module-sync` condition
  // when the BUILDER's Node is ≥22. Some ESM-only packages (e.g. react-router, which ships no
  // production build) expose their `.mjs` solely via `module-sync`; a Node <22 builder then
  // copies the CJS entry while the ≥20.19 runtime imports the missing `.mjs`. So build on Node
  // ≥22 (matching a modern runtime) — the guard above warns otherwise.
  const {fileList, warnings} = await nodeFileTrace(roots, {base, ignore})

  let fileCount = 0
  let byteCount = 0
  for (const rel of fileList) {
    const srcAbs = path.join(base, rel)
    // Never copy the output into itself.
    if (path.resolve(srcAbs).startsWith(path.resolve(standaloneDir))) continue
    const n = await copyEntry(srcAbs, path.join(standaloneDir, rel))
    fileCount += 1
    byteCount += n
  }

  // The app's own `.pylon/**` (transpiled app, glue, page chunks, manifests, media). nft
  // catches the statically-imported ones; copy the tree so the DYNAMIC page chunks are
  // present too. Destination mirrors the base-relative path so imports resolve unchanged.
  const outRel = path.relative(base, outDir)
  const tree = await copyTree(outDir, path.join(standaloneDir, outRel), standaloneDir)
  fileCount += tree.files
  byteCount += tree.bytes

  // The app's base-relative location inside the output (the output root for a lone app;
  // `<output>/<pkg-path>` in a monorepo) — where `.pylon` lives. server.mjs anchors its
  // artifact reads to its own location, so the generated launcher just imports it and the
  // artifact runs from ANY cwd — `node <output>/start.mjs`.
  const appRel = path.relative(base, cwd)
  const runDir = path.join(standaloneDir, appRel)
  const entry = path.join(standaloneDir, path.relative(base, serverEntry))

  // Extra runtime DATA the app reads via `fs` (nft can't trace those). Copy each into the app
  // dir so it sits at the same project-relative path — the launcher chdir's here, so the app's
  // cwd-relative reads (e.g. `content/`) resolve exactly as in development.
  for (const inc of include) {
    const src = path.join(cwd, inc)
    if (!fs.existsSync(src)) {
      console.warn(`[pylon] standalone: --include path not found, skipping: ${inc}`)
      continue
    }
    const dest = path.join(runDir, inc)
    if (fs.statSync(src).isDirectory()) {
      const t = await copyTree(src, dest, standaloneDir)
      fileCount += t.files
      byteCount += t.bytes
    } else {
      await fs.promises.mkdir(path.dirname(dest), {recursive: true})
      byteCount += await copyEntry(src, dest)
      fileCount += 1
    }
  }

  const launcher = path.join(standaloneDir, 'start.mjs')
  await fs.promises.writeFile(
    launcher,
    [
      `// GENERATED by \`pylon build --standalone\` — do not edit. A stable root entry point,`,
      `// runnable from any cwd (\`node start.mjs\`). It chdir's into the app dir so the app's`,
      `// OWN cwd-relative reads (e.g. a \`content/\` dir) resolve; the FRAMEWORK itself anchors`,
      `// to the entry location (server.mjs sets __PYLON_ROOT__) and needs no chdir, so you can`,
      `// also run it directly: node ${path.posix.join(appRel || '.', '.pylon', 'server.mjs')}`,
      `import path from 'node:path'`,
      `import {fileURLToPath, pathToFileURL} from 'node:url'`,
      `const runDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(appRel)})`,
      `process.chdir(runDir)`,
      `await import(pathToFileURL(path.join(runDir, '.pylon', 'server.mjs')).href)`,
      ``
    ].join('\n')
  )

  return {
    outDir: standaloneDir,
    runDir,
    launcher,
    entry,
    fileCount: fileCount + 1,
    byteCount,
    warnings: [...warnings].map(w => w.message)
  }
}
