import path from 'path'
import {Plugin} from '../../..'
import {generateAppFile, getPageRoutes} from './app-utils'
import chokidar, {FSWatcher} from 'chokidar'
import fs from 'fs/promises'
import esbuild from 'esbuild'
import {injectAppHydrationPlugin} from './plugins/inject-app-hydration'
import {imagePlugin} from './plugins/image-plugin'
import {postcssPlugin} from './plugins/postcss-plugin'

const DIST_STATIC_DIR = path.join(process.cwd(), '.pylon/__pylon/static')
const DIST_PAGES_DIR = path.join(process.cwd(), '.pylon/__pylon/pages')

async function updateFileIfChanged(path: string, newContent: string) {
  try {
    const currentContent = await fs.readFile(path, 'utf8')
    if (currentContent === newContent) {
      return false // No update needed
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err // Ignore file not found error
  }

  await fs.writeFile(path, newContent, 'utf8')
  return true // File created or updated
}

export const build: Plugin['build'] = async () => {
  const buildAppFile = async () => {
    const pagesRoutes = await getPageRoutes()
    const appContent = generateAppFile(pagesRoutes)

    const pagesFile = path.resolve(process.cwd(), '.pylon', 'pages.json')
    await updateFileIfChanged(pagesFile, JSON.stringify(pagesRoutes, null, 2))

    // Write if the file doesn't exist or the content is different
    const appFilePath = path.resolve(process.cwd(), '.pylon', 'app.tsx')

    const state = await updateFileIfChanged(appFilePath, appContent)

    if (state) {
      console.log('Updated app file')
    }
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
      await fs.cp(publicDir, pylonPublicDir, {recursive: true})
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err // Ignore file not found error
    }
  }

  const writeOnEndPlugin: esbuild.Plugin = {
    name: 'write-on-end',
    setup(build) {
      build.onEnd(async result => {
        await Promise.all(
          result.outputFiles!.map(async file => {
            await fs.mkdir(path.dirname(file.path), {recursive: true})
            await updateFileIfChanged(file.path, file.text)
          })
        )
      })
    }
  }

  const nodePaths = [
    path.join(process.cwd(), 'node_modules'),
    path.join(process.cwd(), 'node_modules', '@getcronit/pylon/node_modules')
  ]

  let pagesWatcher: FSWatcher | null = null

  const clientCtx = await esbuild.context({
    write: false,
    metafile: true,
    nodePaths,
    absWorkingDir: process.cwd(),
    plugins: [
      injectAppHydrationPlugin,
      imagePlugin,
      postcssPlugin,
      writeOnEndPlugin
    ],
    publicPath: '/__pylon/static',
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    format: 'esm',
    platform: 'browser',
    entryPoints: ['.pylon/app.tsx'],
    outdir: DIST_STATIC_DIR,
    bundle: true,
    splitting: true,
    minify: true,
    loader: {
      // Map file extensions to the file loader

      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file'
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    mainFields: ['browser', 'module', 'main']
  })

  const serverCtx = await esbuild.context({
    write: false,
    absWorkingDir: process.cwd(),
    nodePaths,
    plugins: [imagePlugin, postcssPlugin, writeOnEndPlugin],
    publicPath: '/__pylon/static',
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    format: 'esm',
    platform: 'node',
    entryPoints: ['.pylon/app.tsx'],
    packages: 'external',
    outdir: DIST_PAGES_DIR,
    bundle: true,
    splitting: false,
    minify: true,
    loader: {
      // Map file extensions to the file loader

      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file'
    }
  })

  return {
    watch: async () => {
      console.log('Watching pages directory...')
      pagesWatcher = chokidar.watch('pages', {ignoreInitial: true})

      pagesWatcher!.on('all', async (event, path) => {
        if (['add', 'change', 'unlink'].includes(event)) {
          await buildAppFile()
          await copyPublicDir()
        }
      })

      await Promise.all([clientCtx.watch(), serverCtx.watch()])
    },
    dispose: async () => {
      console.log('Disposing pages')

      if (pagesWatcher) {
        pagesWatcher.close()
      }

      Promise.all([clientCtx.dispose(), serverCtx.dispose()])
    },
    rebuild: async () => {
      console.log('Rebuilding pages')
      await buildAppFile()

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
