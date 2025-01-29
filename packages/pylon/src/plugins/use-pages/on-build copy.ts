import fs from 'fs'
import path from 'path'
import esbuild, {Plugin} from 'esbuild'
import {generateClient} from '@gqty/cli'
import {buildSchema} from 'graphql'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import postcss from 'postcss'
import consola from "consola"

// Function to recursively scan the pages directory and generate file paths and Hono route paths
const getFilePathsAndRoutes = (
  dir: string,
  baseDir: string = path.resolve(process.cwd(), dir)
): {filePath: string; routePath: string}[] => {
  const filePathsAndRoutes: {filePath: string; routePath: string}[] = []

  // Resolve the absolute path of the current directory
  const currentDir = path.resolve(process.cwd(), dir)

  // Read the contents of the directory
  const files = fs.readdirSync(currentDir)

  files.forEach(file => {
    const fullPath = path.join(currentDir, file)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      // Recursively scan subdirectories, passing the same baseDir
      filePathsAndRoutes.push(
        ...getFilePathsAndRoutes(path.join(dir, file), baseDir)
      )
    } else if (stat.isFile() && fullPath.endsWith('.tsx')) {
      // Calculate the relative path from the original base directory
      const relativePath = path.relative(baseDir, fullPath).replace(/\.tsx$/, '')

      // Convert the relative path to Hono route path format
      let routePath = `/${relativePath.replace(/\\/g, '/')}`

      // Handle dynamic parameters like `[slug]`
      routePath = routePath.replace(/\[(.*?)\]/g, ':$1')

      // Remove '/index' from the route path if it's an index file
      if (routePath.endsWith('/index')) {
        routePath = routePath.slice(0, -6) // Remove the '/index' part
      }

      if (!routePath) {
        routePath = '/'
      }

      filePathsAndRoutes.push({
        filePath: fullPath,
        routePath
      })
    }
  })

  return filePathsAndRoutes
}

// Helper function to recursively scan a directory for .tsx files
const getAllFiles = (dirPath: string, ext: string): string[] => {
  let files: string[] = []
  const entries = fs.readdirSync(dirPath, {withFileTypes: true})

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, ext))
    } else if (entry.isFile() && fullPath.endsWith(ext)) {
      files.push(fullPath)
    }
  }

  return files
}

// Function to build files with esbuild from a folder
const buildFilesWithEsbuild = async (sourceDir: string) => {
  console.log('Building files with esbuild...')
  const sourcePath = path.resolve(sourceDir) // Resolve absolute path
  const distPath = path.resolve(process.cwd(), '.pylon/public')

  // Get all .tsx files in the source directory
  const filePaths = getAllFiles(sourcePath, '.tsx')

  if (filePaths.length === 0) {
    console.log(`No .tsx files found in ${sourcePath}`)
    return []
  }

  const buildResults: {filePath: string; success: boolean}[] = []

  // for (const filePath of filePaths) {
  //   try {
  //     // Determine relative path and output file path
  //     const relativePath = path.relative(sourcePath, filePath)
  //     const outFile = path.join(distPath, relativePath.replace(/\.tsx$/, '.js'))

  //     // Ensure the output directory exists
  //     fs.mkdirSync(path.dirname(outFile), {recursive: true})

  //     // Run esbuild to transpile the TypeScript file
  //     await esbuild.build({
  //       format: 'esm',
  //       entryPoints: [filePath],
  //       outfile: outFile,
  //       bundle: false,
  //       minify: true,
  //       sourcemap: true,

  //       loader: {
  //         '.tsx': 'tsx'
  //       },

  //       jsx: 'automatic',
  //       tsconfigRaw: {}
  //     })

  //     buildResults.push({filePath, success: true})
  //     console.log(`Built: ${filePath} -> ${outFile}`)
  //   } catch (error) {
  //     buildResults.push({filePath, success: false})
  //     console.error(`Error building: ${filePath}`, error)
  //   }
  // }

  const injectHydrationPlugin: Plugin = {
    name: 'inject-hydration',
    async setup(build) {
      build.onLoad({filter: /.*/, namespace: 'file'}, async args => {
        const isEntryPoint = filePaths.includes(args.path)

        if (isEntryPoint) {
          const contents = await fs.promises.readFile(args.path, 'utf-8')

          // Find default export name
          const defaultExportMatch = contents.match(
            /export\s+default\s+([^;]+)/
          )
          const defaultExport = defaultExportMatch
            ? defaultExportMatch[1]
            : null

          const clientPath = path.resolve(process.cwd(), '.pylon/client')


          const pathToClient = path.relative(
            path.dirname(args.path),
            clientPath
          )

          return {
            loader: 'tsx',
            contents:
              contents +
              `
            if(typeof window !== 'undefined') {
               const {PylonPageLoader} = await import("@getcronit/pylon/page-loader.js")
               const client = await import("${pathToClient}")

                const {default: reactDom} = await import('react-dom/client')

                const scriptElement = document.getElementById("__PYLON_DATA__")

                if(!scriptElement) {
                  throw new Error('Pylon data script not found')
                }

                try {
                  const pylonData = JSON.parse(scriptElement.textContent)

                  const clientBundlePaths = {
                    js: pylonData.pageProps.path === '/' ? '/public/index.js' : '/public' + pylonData.pageProps.path + '/index.js',
                    css: pylonData.pageProps.path === '/' ? '/public/index.css' : '/public' + pylonData.pageProps.path + '/index.css'
                  }

                  reactDom.hydrateRoot(
                document.getElementById('root'),
                <PylonPageLoader clientBundlePaths={clientBundlePaths} client={client} Page={${defaultExport}} pageProps={pylonData.pageProps} cacheSnapshot={pylonData.cacheSnapshot}/>
                )
                }
                catch(error) {
                  console.error('Error hydrating root', error)
                }
                

            }
                        `
          }
        }
      })
    }
  }

  await esbuild.build({
    absWorkingDir: process.cwd(),
    plugins: [injectHydrationPlugin],
    publicPath: '/public',
    assetNames: "[dir]/[name]-[hash]",
    format: 'esm',
    platform: 'browser',
    entryPoints: filePaths,
    outdir: distPath,
    bundle: true,
    splitting: true,
    minify: false,
    loader: {
      // Map file extensions to the file loader
      '.png': 'file',
      '.jpg': 'file',
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
  })

  // Also build for server
  await esbuild.build({
    absWorkingDir: process.cwd(),
    plugins: [injectHydrationPlugin],
    publicPath: '/public',
    assetNames: "[dir]/[name]-[hash]",
    format: 'esm',
    platform: 'node',
    entryPoints: filePaths,
    outdir: path.resolve(process.cwd(), '.pylon/pages'),
    bundle: true,
    packages: "external",
    splitting: false,
    minify: false,
    loader: {
      // Map file extensions to the file loader
      '.png': 'file',
      '.jpg': 'file',
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
  })

  const tailwindConfigPath = path.resolve(process.cwd(), 'tailwind.config.js')
  const inputCss = fs.readFileSync('./globals.css', 'utf-8')

  // Process Tailwind CSS with PostCSS
  async function generateTailwindCss() {
    try {
      const {default: tailwindConfig} = await import(tailwindConfigPath)

      console.log('tailwindConfig', tailwindConfig)

      const result = await postcss([
        tailwindcss(tailwindConfig), // Use your Tailwind config
        autoprefixer
      ]).process(inputCss, {
        from: undefined // Prevent source map generation
      })

      // Write the generated CSS to a file
      fs.writeFileSync('.pylon/public/output.css', result.css)

      console.log('Tailwind CSS generated successfully!')
    } catch (error) {
      console.error('Error generating Tailwind CSS:', error)
    }
  }

  await generateTailwindCss()

  console.log('Built files with esbuild')

  return buildResults
}

// Main function to build frontend
 const buildFrontend = async () => {
  const schema = fs.readFileSync(
    path.resolve(process.cwd(), '.pylon', 'schema.graphql'),
    'utf-8'
  )

  generateClient(buildSchema(schema), {
    destination: path.resolve(process.cwd(), '.pylon', 'client/index.ts')
  }).then(() => {
    console.log('Client generated')
  })

  await buildFilesWithEsbuild(
    path.resolve(process.cwd(), './pages')
  )

  const pages = getFilePathsAndRoutes('./pages')

  console.log('Pages:', pages)

  // Write the pages to a JSON file
  fs.writeFileSync(
    path.resolve(process.cwd(), '.pylon/pages.json'),
    JSON.stringify(pages, null, 2)
  )

  return pages
}

export const onBuild = async () => {
  consola.start("Building Frontend")

  await buildFrontend()

  consola.success("Frontend Built")
}
