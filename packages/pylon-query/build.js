import esbuild from 'esbuild'

// Runtime entry (browser + node; React peer is external).
await esbuild.build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'neutral',
  target: 'es2022',
  format: 'esm',
  outfile: './dist/index.js',
  sourcemap: 'linked',
  packages: 'external'
})

// Build-time helpers entry (node only; uses `graphql`).
await esbuild.build({
  entryPoints: ['./src/build/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: './dist/build/index.js',
  sourcemap: 'linked',
  packages: 'external'
})
