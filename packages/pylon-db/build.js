import esbuild from 'esbuild'

await esbuild.build({
  write: true,
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: './dist',
  sourcemap: 'linked',
  packages: 'external'
})
