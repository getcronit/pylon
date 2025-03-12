import esbuild from 'esbuild'

async function buildAll() {
  const res = await esbuild.build({
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

  const res2 = await esbuild.build({
    entryPoints: ['./src/pages/index.ts'],
    bundle: true,
    platform: 'browser',
    target: 'esnext',
    format: 'esm',
    outdir: './dist/pages',
    sourcemap: 'linked',
    packages: 'external'
  })
}

await buildAll()
