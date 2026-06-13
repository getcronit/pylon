import esbuild from 'esbuild'

// Core is server/GraphQL-only. The frontend page pipeline (browser build +
// PostCSS) moved to @getcronit/pylon-pages, so core builds a single node bundle.
await esbuild.build({
  write: true,
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: './dist',
  sourcemap: 'linked',
  packages: 'external',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]'
})
