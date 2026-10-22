// PROTOTYPE: prune a deployed Pylon app to its real runtime file closure with
// @vercel/nft (Node File Trace), the way Next's `output: 'standalone'` does.
//
// Runs over an already-flattened tree (the pnpm-deploy output at BASE), traces
// the actual import graph from .pylon/server.mjs, and copies ONLY the files that
// graph needs into OUT — plus the runtime DATA nft can't see (markdown read via
// fs, baked static assets). Everything unused inside each package is left behind.
import {nodeFileTrace} from '@vercel/nft'
import {promises as fs} from 'fs'
import path from 'path'

const BASE = process.env.NFT_BASE || '/prod'
const OUT = process.env.NFT_OUT || '/standalone'

// usePages loads the compiled page modules in .pylon/__pylon at REQUEST time (SSR),
// and those import react/etc. externally — so they're NOT in server.mjs's static
// graph. Trace them as extra entry points, or their deps (react) go uncopied.
async function walkJs(dir) {
  const out = []
  for (const e of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkJs(full)))
    else if (/\.m?js$/.test(e.name)) out.push(full)
  }
  return out
}
// Trace EVERY js in .pylon (server.mjs + src + client + __pylon page modules) so
// the node_modules deps of all runtime-loaded app code get copied. nft's job here
// is pruning node_modules; the .pylon app output itself is small and copied whole.
const ENTRIES = await walkJs(path.join(BASE, '.pylon'))

// Resolve export conditions the SAME way the Node ESM runtime will. Without this,
// nft may pick a different branch than runtime — e.g. react-router lists
// `react-server` first, so nft grabbed index-react-server.mjs while Node resolves
// the `node` condition to index.mjs → the file it needs is never copied.
const {fileList, warnings} = await nodeFileTrace(ENTRIES, {
  base: BASE,
  conditions: ['node', 'import', 'module-sync', 'module']
})

let files = 0
for (const rel of fileList) {
  const src = path.join(BASE, rel)
  const dst = path.join(OUT, rel)
  await fs.mkdir(path.dirname(dst), {recursive: true})
  const st = await fs.lstat(src).catch(() => null)
  if (!st) continue
  if (st.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(src), dst).catch(() => {})
  } else {
    await fs.copyFile(src, dst)
  }
  files++
}

// Safety net: some packages do heavy DYNAMIC requires nft can't follow —
// @opentelemetry/@sentry auto-instrumentation load "incubating"/plugin entrypoints
// by computed path. Whole-copy those .pnpm trees rather than chase each missed file.
const WHOLE_COPY = ['@opentelemetry+', '@sentry+']
const pnpmDir = path.join(BASE, 'node_modules/.pnpm')
for (const entry of await fs.readdir(pnpmDir).catch(() => [])) {
  if (WHOLE_COPY.some(p => entry.startsWith(p))) {
    await fs
      .cp(path.join(pnpmDir, entry), path.join(OUT, 'node_modules/.pnpm', entry), {
        recursive: true,
        verbatimSymlinks: true // preserve pnpm's inter-package symlinks as-is
      })
      .catch(() => {})
  }
}

// Runtime data the tracer can't discover (read via fs at request time), verbatim:
//   .pylon/__pylon  — public assets baked in by `pylon build`
//   content         — markdown read by src/lib/content.ts per request
//   package.json    — "type":"module" so .pylon/**/*.js load as ESM
for (const d of ['.pylon', 'content', 'public']) {
  await fs
    .cp(path.join(BASE, d), path.join(OUT, d), {recursive: true, verbatimSymlinks: true})
    .catch(() => {})
}
await fs.copyFile(path.join(BASE, 'package.json'), path.join(OUT, 'package.json')).catch(() => {})

if (warnings?.length) {
  console.log(`nft: ${warnings.length} warning(s) (first 5):`)
  for (const w of warnings.slice(0, 5)) console.log('  •', w.message || String(w))
}
console.log(`nft: traced ${fileList.size} files → copied ${files} into ${OUT}`)
