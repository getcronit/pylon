import {Plugin} from '@/index'
import chokidar, {FSWatcher} from 'chokidar'
import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import {makeAppFiles} from './app-utils'
import {esmExternalsPlugin} from './plugins/external-esm-plugin'
import {imagePlugin} from './plugins/image-plugin'
import {injectAppHydrationPlugin} from './plugins/inject-app-hydration'
import {postcssPlugin} from './plugins/postcss-plugin'
import {useDataStaticAnalyzer} from './plugins/use-data-static-analyzer'
import {StaticAnalysisManager} from './plugins/use-data-static-analyzer/manager'

const DIST_STATIC_DIR = path.join(process.cwd(), '.pylon/__pylon/static')
const DIST_PAGES_DIR = path.join(process.cwd(), '.pylon/__pylon/pages')

async function updateFileIfChanged(
  filePath: string,
  newContent: Uint8Array<ArrayBufferLike>
) {
  // Make sure the directory exists
  await fs.mkdir(path.dirname(filePath), {recursive: true})

  try {
    const currentContent = await fs.readFile(filePath)
    if (currentContent.equals(newContent)) {
      return false // No update needed
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err // Ignore file not found error
  }

  await fs.writeFile(filePath, newContent)
  return true // File created or updated
}

export const build: NonNullable<Plugin['build']> = async ({onBuild}) => {
  const version = Math.random().toString(36).substring(7)

  const buildAppFile = async () => {
    const appFiles = makeAppFiles()

    await updateFileIfChanged(
      path.resolve(process.cwd(), '.pylon', 'app.tsx'),
      Buffer.from(appFiles.routes)
    )
  }

  const copyPublicDir = async () => {
    // Copy the ./public directory content to the .pylon/__pylon/static directory
    const publicDir = path.resolve(process.cwd(), 'public')
    const pylonPublicDir = path.resolve(
      process.cwd(),
      '.pylon',
      '__pylon',
      'public'
    )

    try {
      await fs.access(publicDir)

      // Copy recursively the public directory to the static directory
      await fs.mkdir(pylonPublicDir, {recursive: true})
      await fs.cp(publicDir, pylonPublicDir, {recursive: true, force: true})
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err // Ignore file not found error
    }
  }

  const pylonCssPath = path.join(
    process.cwd(),
    'node_modules',
    '@getcronit/pylon/dist/pages/index.css'
  )

  const buildAppFilePlugin: esbuild.Plugin = {
    name: 'build-app-file',
    setup(build) {
      build.onStart(async () => {
        await buildAppFile()
      })
    }
  }

  const writeOnEndPlugin: esbuild.Plugin = {
    name: 'write-on-end',
    setup(build) {
      build.initialOptions.metafile = true
      build.initialOptions.write = false
      build.onEnd(async result => {
        const manifest: Record<string, string> = {}

        for (const [key, value] of Object.entries(
          result.metafile?.outputs || {}
        )) {
          if (value.entryPoint === '.pylon/app.tsx') {
            manifest['app.js'] = key
            if (value.cssBundle) {
              manifest['app.css'] = value.cssBundle
            }
          } else if (value.entryPoint?.endsWith('pylon/dist/pages/index.css')) {
            manifest['index.css'] = key
          } else if (value.entryPoint?.endsWith('pages/sitemap.ts')) {
            manifest['sitemap.js'] = key
          }
        }

        if (build.initialOptions.publicPath) {
          const publicPath = build.initialOptions.publicPath

          for (const [key, value] of Object.entries(manifest)) {
            const index = value.indexOf(publicPath)

            if (index !== -1) {
              // Slice from the start of the publicPath to the end of the string
              manifest[key] = value.slice(index)
            }
          }
        }

        manifest['version'] = version

        await updateFileIfChanged(
          path.join(build.initialOptions.outdir!, 'manifest.json'),
          Buffer.from(JSON.stringify(manifest, null, 2))
        )

        await Promise.all(
          result.outputFiles!.map(async file => {
            await fs.mkdir(path.dirname(file.path), {recursive: true})
            await updateFileIfChanged(file.path, file.contents)
          })
        )
        if (result.errors.length === 0) {
          onBuild()
        }
      })
    }
  }

  const nodePaths = [
    path.join(process.cwd(), 'node_modules'),
    path.join(process.cwd(), 'node_modules', '@getcronit/pylon/node_modules')
  ]

  let pagesWatcher: FSWatcher | null = null

  const timePlugin = (name: string): esbuild.Plugin => ({
    name: 'rebuild-log',
    setup({onStart, onEnd}) {
      var t
      onStart(() => {
        t = Date.now()
      })
      onEnd(() => {
        console.log(`Pages [${name}] Rebuild took ${Date.now() - t}ms`)
      })
    }
  })

  const sitemapExists = await fs
    .access(path.join(process.cwd(), 'pages/sitemap.ts'))
    .then(() => true)
    .catch(() => false)

  const analysisManager = new StaticAnalysisManager()

  const clientCtx = await esbuild.context({
    sourcemap: 'linked',
    write: false,
    metafile: true,
    nodePaths,
    absWorkingDir: process.cwd(),
    plugins: [
      buildAppFilePlugin,
      injectAppHydrationPlugin(version),
      useDataStaticAnalyzer({debug: true, manager: analysisManager}),
      imagePlugin,
      postcssPlugin,
      writeOnEndPlugin,
      timePlugin('client')
    ],
    publicPath: '/__pylon/static',
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: './[name]-[hash]',
    format: 'esm',
    platform: 'browser',
    entryPoints: ['.pylon/app.tsx', pylonCssPath],
    outdir: DIST_STATIC_DIR,
    bundle: true,
    splitting: true,
    minify: false,
    loader: {
      // Map file extensions to the file loader

      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.otf': 'file'
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development'
      )
    },
    mainFields: ['browser', 'module', 'main']
  })

  const serverCtx = await esbuild.context({
    sourcemap: 'inline',
    write: false,
    metafile: true,
    absWorkingDir: process.cwd(),
    nodePaths,
    plugins: [
      buildAppFilePlugin,
      useDataStaticAnalyzer({debug: true, manager: analysisManager}),
      imagePlugin,
      postcssPlugin,
      writeOnEndPlugin,
      timePlugin('server'),
      esmExternalsPlugin([
        '@getcronit/pylon',
        'react',
        'react-dom',
        'gqty',
        '@gqty/react'
      ])
    ],
    publicPath: '/__pylon/static',
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: './[name]-[hash]',
    format: 'esm',
    platform: 'node',
    entryPoints: [
      '.pylon/app.tsx',
      pylonCssPath,
      ...(sitemapExists ? ['./pages/sitemap.ts'] : [])
    ],

    outdir: DIST_PAGES_DIR,
    bundle: true,
    splitting: false,
    external: ['@getcronit/pylon', 'react', 'react-dom', 'gqty', '@gqty/react'],
    minify: true,
    loader: {
      // Map file extensions to the file loader

      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.otf': 'file'
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development'
      )
    },
    mainFields: ['module', 'main']
  })

  return {
    watch: async () => {
      await buildAppFile()
      await copyPublicDir()

      pagesWatcher = chokidar.watch('pages', {ignoreInitial: true})

      pagesWatcher!.on('all', async (event, path) => {
        if (['add', 'change', 'unlink'].includes(event)) {
          await copyPublicDir()
        }
      })

      await Promise.all([clientCtx.watch(), serverCtx.watch()])
    },
    dispose: async () => {
      if (pagesWatcher) {
        pagesWatcher.close()
      }

      Promise.all([clientCtx.dispose(), serverCtx.dispose()])
    },
    rebuild: async () => {
      await copyPublicDir()

      await Promise.all([clientCtx.rebuild(), serverCtx.rebuild()])

      return {} as any
    },
    cancel: async () => {
      if (pagesWatcher) {
        await pagesWatcher.close()
      }

      await Promise.all([clientCtx.cancel(), serverCtx.cancel()])
    }
  }
}
