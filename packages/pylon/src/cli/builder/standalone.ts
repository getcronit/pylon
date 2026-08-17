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
}): Promise<StandaloneResult> {
  const {cwd, outDir} = opts
  const serverEntry = path.join(outDir, 'server.mjs')
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `standalone: ${serverEntry} not found — run the build before tracing (this is an internal ordering bug).`
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
      opts?: {base?: string}
    ) => Promise<{fileList: Set<string>; warnings: Set<Error>}>
  }

  const {fileList, warnings} = await nodeFileTrace(roots, {base})

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
  const launcher = path.join(standaloneDir, 'start.mjs')
  await fs.promises.writeFile(
    launcher,
    [
      `// GENERATED by \`pylon build --standalone\` — do not edit. A stable root entry point:`,
      `// imports the traced server by absolute path. server.mjs resolves its artifacts from`,
      `// its OWN location (it sets globalThis.__PYLON_ROOT__), so this runs from ANY cwd — no`,
      `// chdir needed. You can also run the entry directly: node ${path.posix.join(appRel || '.', '.pylon', 'server.mjs')}`,
      `import path from 'node:path'`,
      `import {fileURLToPath, pathToFileURL} from 'node:url'`,
      `const here = path.dirname(fileURLToPath(import.meta.url))`,
      `await import(pathToFileURL(path.join(here, ${JSON.stringify(appRel)}, '.pylon', 'server.mjs')).href)`,
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
