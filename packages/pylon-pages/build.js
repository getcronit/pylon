import esbuild from 'esbuild'
import path from 'path'
import fs from 'fs/promises'
import loadConfig from 'postcss-load-config'
import postcss from 'postcss'

export const postcssPlugin = {
  name: 'postcss-plugin',
  setup(build) {
    build.onLoad({filter: /.css$/, namespace: 'file'}, async args => {
      const {plugins, options} = await loadConfig()

      const css = await fs.readFile(args.path, 'utf-8')

      const result = await postcss(plugins)
        .process(css, {
          ...options,
          from: args.path
        })
        .then(result => result)

      return {
        contents: result.css,
        loader: 'css'
      }
    })
  }
}

async function buildAll() {
  const res = await esbuild.build({
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
    entryPoints: ['./src/browser/index.ts'],
    bundle: true,
    platform: 'browser',
    target: 'esnext',
    format: 'esm',
    outdir: './dist/browser',
    sourcemap: 'linked',
    packages: 'external',
    plugins: [postcssPlugin]
  })
}

await buildAll()
