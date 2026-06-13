import esbuild from 'esbuild'

await esbuild.build({
  write: true,
  entryPoints: ['./src/index.ts', './src/contract.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: './dist',
  sourcemap: 'linked',
  packages: 'external',
  // CRITICAL: the `index` and `contract` entry points both reach `errors.ts`
  // (ForbiddenError). Without splitting, esbuild inlines a SEPARATE copy into
  // each bundle → two distinct classes at runtime → `instanceof` fails across
  // the pylon-app (index) and pylon-db (/contract) import paths. Splitting hoists
  // the shared modules into one chunk, so there's a single ForbiddenError.
  splitting: true
})
