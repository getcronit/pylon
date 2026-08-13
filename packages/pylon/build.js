import esbuild from 'esbuild'
import fs from 'fs/promises'
import loadConfig from 'postcss-load-config'
import postcss from 'postcss'

// Consolidated build for the fat @getcronit/pylon package. Emits one output per
// public `exports` subpath (see package.json). Two esbuild passes:
//   • NODE   — server/CLI/plugin entries + the ORM/queues/auth/ir engines
//   • BROWSER — the client-bundled runtimes (pages, query) + PostCSS
//
// Cross-feature self-imports (`@getcronit/pylon`, `@getcronit/pylon/<feature>`)
// are EXTERNAL: at runtime they resolve to the sibling dist subpath via the
// exports map (not bundled — avoids duplicating db into pages, etc.). tsconfig
// `paths` still map them to ./src so `tsc` typechecks against source.
//
// NOTE: untested until the workspace is installable (see the consumer-migration
// blocker); expect to iterate esbuild options (splitting/external/outbase) here.
const SELF_EXTERNAL = ['@getcronit/pylon', '@getcronit/pylon/*']

const common = {
  bundle: true,
  format: 'esm',
  outbase: 'src', // src/db/plugin.ts -> dist/db/plugin.js
  outdir: 'dist',
  sourcemap: 'linked',
  packages: 'external',
  external: SELF_EXTERNAL,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]'
}

const nodeEntries = [
  'src/index.ts', // . (core)
  'src/db/index.ts',
  'src/db/plugin.ts',
  'src/ir/index.ts',
  'src/queues/index.ts',
  'src/queues/plugin.ts',
  'src/auth/index.ts',
  'src/auth/plugin.ts',
  'src/auth/contract.ts',
  'src/auth/zitadel.ts',
  'src/pages/plugin.ts', // usePages (node/build-time)
  'src/cli/index.ts' // the `pylon` bin
]

// Browser-facing runtimes bundled into the client by consumers; keep them free of
// Node-only imports (enforce with a bundle check in CI).
const browserEntries = [
  'src/pages/index.ts', // ./pages runtime (+ index.css via PostCSS)
  'src/query/index.ts' // ./query typed-client runtime
]

const postcssPlugin = {
  name: 'postcss',
  setup(build) {
    build.onLoad({filter: /\.css$/, namespace: 'file'}, async args => {
      const {plugins, options} = await loadConfig()
      const css = await fs.readFile(args.path, 'utf-8')
      const result = await postcss(plugins).process(css, {...options, from: args.path})
      return {contents: result.css, loader: 'css'}
    })
  }
}

await esbuild.build({...common, entryPoints: nodeEntries, platform: 'node', target: 'node18'})
await esbuild.build({
  ...common,
  entryPoints: browserEntries,
  platform: 'browser',
  target: 'esnext',
  plugins: [postcssPlugin]
})
