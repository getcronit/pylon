
import path from 'path';
import fs from 'fs';
import { generateClient } from '@gqty/cli';
import { buildSchema } from 'graphql';
import consola from 'consola';
import esbuild, { Plugin } from 'esbuild';
import glob from 'tiny-glob';
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import postcss from 'postcss'



// Root directory for your app
const APP_DIR = path.join(process.cwd(), 'pages');

const DIST_PUBLIC_DIR = path.join(process.cwd(), '.pylon/public')
const DIST_PAGES_DIR = path.join(process.cwd(), '.pylon/pages')


export type PageRoute = {
  pagePath: string;
  slug: string;
  layouts: string[]
}

// Helper function to get page routes with layouts
async function getPageRoutes(dir = APP_DIR) {
  const routes: PageRoute[] = [];

  // Glob pattern for `page.tsx` and `page.js` files
  const pagePattern = path.join(dir, '**/page.{ts,tsx,js}');  // Matches page.tsx, page.js, page.ts

  // Glob pattern for layout files
  const layoutPattern = path.join(dir, '**/layout.tsx');  // Matches layout.tsx files

  // Get all page files
  const pageFiles = await glob(pagePattern);

  // Get all layout files
  const layoutFiles = await glob(layoutPattern);

  for (const pagePath of pageFiles) {
    const relativePagePath = path.relative(APP_DIR, pagePath); // Get the relative path from the app folder
    let slug = '/' + relativePagePath.replace(/page\.(ts|tsx|js)$/, '').replace(/\[([\w-]+)\]/g, ':$1');

    // Make sure there is no trailing slash
    slug = slug.replace(/\/$/, '');

    // Find layouts relevant to this page
    const layouts = layoutFiles.filter(layout => {
      return pagePath.startsWith(layout.replace('layout.tsx', ''));
    });

    const layoutsWithoutRootLayout = layouts.slice(1)

    routes.push({
      pagePath: pagePath,
      slug: slug || '/',
      layouts: layoutsWithoutRootLayout,
    });
  }

  return routes;
}

async function buildPages(pageRoutes: PageRoute[]) {
  // Includes page.tsx and layout.tsx files
  const entryPoints: string[] = []

  for (const page of pageRoutes) {
    entryPoints.push(page.pagePath)
    entryPoints.push(...page.layouts)
  }

  const injectAppHydrationPlugin: Plugin = {
    name: 'inject-hydration',
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
        // check if the file is the app.tsx file
        if (args.path === path.resolve(process.cwd(), '.pylon', 'app.tsx')) {
          console.log("args.path", args.path)
          let contents = await fs.promises.readFile(args.path, 'utf-8')

          const clientPath = path.resolve(process.cwd(), '.pylon/client')


          const pathToClient = path.relative(
            path.dirname(args.path),
            clientPath
          )

          
          contents += `
          import {hydrateRoot} from 'react-dom/client'
          import * as client from './${pathToClient}'
          import {AppLoader} from '@getcronit/pylon/page-loader.js'
          import {BrowserRouter} from 'react-router'

          const pylonData = window.__PYLON_DATA__

          console.log('pylonData', pylonData)

          hydrateRoot(
          document,
            <AppLoader Router={BrowserRouter} client={client} pylonData={pylonData} App={App} />
          )
          `

          return {
            loader: 'tsx',
            contents
          }
        }
      })
    }
  }

  const injectPageLayoutPlugin: Plugin = {
    name: 'inject-layouts',
    async setup(build) {
      build.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
        const isEntryPoint = pageRoutes.find(route => {
          // args.path is the absolute path to the file, route.pagePath is relative to the cwd

          const relativePath = path.relative(process.cwd(), args.path)

          return route.pagePath === relativePath
        })

        if (isEntryPoint) {
          let contents = await fs.promises.readFile(args.path, 'utf-8')

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

          const layouts = (pageRoutes.find(route => {
            return route.pagePath === path.relative(process.cwd(), args.path)
          })?.layouts || []).map(layout => {
            const pathToLayout = path.relative(
              path.dirname(args.path),
              layout
            )

            return pathToLayout.replace('.tsx', '.js')
          })

          if (defaultExport) {


            const layoutImports = layouts.map(layout => {
              return `import Layout${layouts.indexOf(layout)} from './${layout}';`
            }).join('\n')


            function wrapWithLayouts(defaultExport: string, layouts: string[], propsName: string = "props"): string {
              // Generate JSX code for the nested layouts
              const nestedLayouts = layouts.reduceRight((child, layout) => {
                return `<${layout}>${child}</${layout}>`;
              }, `<${defaultExport} {...${propsName}} />`);
            
              // Return the full JSX string
              return nestedLayouts;
            }



            const wrapped = wrapWithLayouts(defaultExport, layouts.map((_, index) => `Layout${index}`))


            contents = contents.replace(
              `export default ${defaultExport}`,
              `${layoutImports}
              const PylonPage = (props) => {
                return (
                  ${wrapped}
                )
              }
                
              export default PylonPage;
              `
            )




          }


          return {
            loader: 'tsx',
            contents:
              contents
          }
        }
      })
    }
  }

  const generateAppComponent = (pageRoutes: PageRoute[]): string => {
  
    const makePageMap = (routes: PageRoute[]) => {
      const pageMap: Record<string, string> = {}
      for (const route of routes) {
        pageMap[route.pagePath] = `Page${fnv1aHash(route.pagePath)}`
      }
      return pageMap
    }
  
  
  
  const makeLayoutMap = (routes: PageRoute[]) => {
      const layoutMap: Record<string, string> = {}
      for (const route of routes) {
        for (const layout of route.layouts) {
          layoutMap[layout] = `Layout${fnv1aHash(layout)}`
        }
      }
      return layoutMap
    }

    const pageMap = makePageMap(pageRoutes)
    const layoutMap = makeLayoutMap(pageRoutes)

    const importPages = Object.keys(pageMap).map((pagePath, index) => {
      const importLocation = `../${pagePath}`.replace('.tsx', '.js');
      const componentName = pageMap[pagePath];

      return `const ${componentName} = lazy(() => import('${importLocation}'))
      `;
    }).join('\n');

    const importLayouts = Object.keys(layoutMap).map((layoutPath, index) => {
      const importLocation = `../${layoutPath}`.replace('.tsx', '.js');
      const componentName = layoutMap[layoutPath];

      return `const ${componentName} = lazy(() => import('${importLocation}'))
      `;
    }).join('\n');

  
    // Dynamically build the App component with React Router Routes
    const appComponent = `"use client";
  import {lazy, Suspense} from 'react'
  import { Routes, Route } from 'react-router';
  ${importPages}
  const RootLayout = lazy(() => import('../pages/layout.js'))
  ${importLayouts}
  
  const App: React.FC<{pageProps: any}> = ({pageProps}) => (
  <RootLayout>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>App</title>
      <link rel="stylesheet" href="/public/output.css" />
         <Routes>
        ${pageRoutes.map((route, index) => {
      return `<Route key={${index}} index={${
        index === 0 ? 'true' : 'false'
        }} path="${route.slug}" element={
         <Suspense fallback={<div>...</div>}>
            ${route.layouts.reduceRight((child, layoutPath, layoutIndex) => {
            const layoutName = layoutMap[layoutPath]

            return `<${layoutName}>${child}</${layoutName}>`
          }, `<${pageMap[route.pagePath]} {...pageProps} />`)}

         </Suspense>} />`

    }).join('\n')}
    </Routes>
    </RootLayout>
  );
  
  export default App;
    `;
  
    return appComponent;
  };

  const appFile = generateAppComponent(pageRoutes)

  console.log('appFile', appFile)
  
  fs.writeFileSync(
    path.resolve(process.cwd(), ".pylon", 'app.tsx'),
    appFile
  )

  console.log("entryPoints", [...entryPoints, "app.tsx"])

  const meta = await esbuild.build({
    metafile: true,
    absWorkingDir: process.cwd(),
    plugins: [injectAppHydrationPlugin],
    publicPath: '/public',
    assetNames: "[dir]/[name]-[hash]",
    format: 'esm',
    platform: 'browser',
    entryPoints: [".pylon/app.tsx"],
    outdir: DIST_PUBLIC_DIR,
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
    // define: {
    //   'process.env.NODE_ENV': '"production"'
    // },
    mainFields: ["browser", "module", "main"],
  })

  fs.writeFileSync(
    path.resolve(process.cwd(), '.pylon', 'meta.json'),
    JSON.stringify(meta.metafile, null, 2)
  )

  // Also build for server
  await esbuild.build({
    absWorkingDir: process.cwd(),
    plugins: [],
    publicPath: '/public',
    assetNames: "[dir]/[name]-[hash]",
    format: 'esm',
    platform: 'node',
    entryPoints: [".pylon/app.tsx"],
    outdir: DIST_PAGES_DIR,
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

}

async function buildTailwind() {
  const tailwindConfigPath = path.resolve(process.cwd(), 'tailwind.config.js')
  const inputCss = fs.readFileSync('./globals.css', 'utf-8')

  try {
    const { default: tailwindConfig } = await import(tailwindConfigPath)

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


async function buildClient() {
  const schema = fs.readFileSync(
    path.resolve(process.cwd(), '.pylon', 'schema.graphql'),
    'utf-8'
  )

  await generateClient(buildSchema(schema), {
    destination: path.resolve(process.cwd(), '.pylon', 'client/index.ts')
  })
}

// // Main function to build frontend
//  const buildFrontend = async () => {
//   const schema = fs.readFileSync(
//     path.resolve(process.cwd(), '.pylon', 'schema.graphql'),
//     'utf-8'
//   )

//   generateClient(buildSchema(schema), {
//     destination: path.resolve(process.cwd(), '.pylon', 'client/index.ts')
//   }).then(() => {
//     console.log('Client generated')
//   })

//   await buildFilesWithEsbuild(
//     path.resolve(process.cwd(), './pages')
//   )

//   const pages = getPageRoutes()

//   console.log('Pages:', pages)

//   // Write the pages to a JSON file
//   fs.writeFileSync(
//     path.resolve(process.cwd(), '.pylon/pages.json'),
//     JSON.stringify(pages, null, 2)
//   )

//   return pages
// }

export const onBuild = async () => {
  consola.start("Building Frontend")

  const routes = await getPageRoutes()

  // Save the routes to a JSON file
  fs.writeFileSync(
    path.resolve(process.cwd(), '.pylon', 'pages.json'),
    JSON.stringify(routes, null, 2)
  )

  await buildPages(routes)

  await buildTailwind()
  await buildClient()

  consola.success("Frontend Built")
}



function fnv1aHash(str: string) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}