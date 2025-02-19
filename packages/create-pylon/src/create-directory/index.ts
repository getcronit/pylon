import fs from 'fs/promises'
import path from 'path'
import {files} from './files'

export const runtimes = [
  {
    key: 'bun',
    name: 'Bun.js',
    website: 'https://bunjs.dev',
    supportedFeatures: ['auth', 'pages']
  },
  {
    key: 'node',
    name: 'Node.js',
    website: 'https://nodejs.org',
    supportedFeatures: ['auth', 'pages']
  },
  {
    key: 'cf-workers',
    name: 'Cloudflare Workers',
    website: 'https://workers.cloudflare.com',
    supportedFeatures: ['auth']
  },
  {
    key: 'deno',
    name: 'Deno',
    website: 'https://deno.land'
  }
]

export const features = [
  {
    key: 'auth',
    name: 'Authentication',
    website: 'https://pylon.cronit.io/docs/authentication'
  },
  {
    key: 'pages',
    name: 'Pages',
    website: 'https://pylon.cronit.io/docs/pages'
  }
]

export type Runtime = (typeof runtimes)[number]['key']
export type Feature = (typeof features)[number]['key']

interface CreateDirectoryOptions {
  variables: Record<string, string>
  destination: string
  runtime: Runtime
  features: Feature[]
}

const makeIndexFile = (runtime: Runtime, features: Feature[]) => {
  const pylonImports: string[] = ['app', 'PylonConfig']
  const pylonConfigPlugins: string[] = []

  if (features.includes('auth')) {
    pylonImports.push('useAuth')
    pylonConfigPlugins.push(
      "useAuth({issuer: 'https://test-0o6zvq.zitadel.cloud'})"
    )
  }

  if (features.includes('pages')) {
    pylonImports.push('usePages')
    pylonConfigPlugins.push('usePages()')
  }

  let content: string = ''

  // Add imports
  content += `import {${pylonImports.join(', ')}} from '@getcronit/pylon'\n\n`

  if (runtime === 'node') {
    content += `import {serve} from '@hono/node-server'\n`
  }

  content += '\n\n'

  // Add graphql
  content += `export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    }
  },
  Mutation: {}
}`

  content += '\n\n'

  if (runtime === 'bun' || runtime === 'cf-workers') {
    content += `export default app`
  } else if (runtime === 'node') {
    content += `serve(app, info => {
  console.log(\`Server running at \${info.port}\`)
})`
  } else if (runtime === 'deno') {
    content += `Deno.serve({port: 3000}, app.fetch)
`
  }

  content += '\n\n'

  content += `export const config: PylonConfig = {
  plugins: [${pylonConfigPlugins.join(', ')}]
}`

  return content
}

const makePylonDefinition = async (runtime: Runtime, features: Feature[]) => {
  let data = `import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {}

  interface Variables {}
}


`

  if (features.includes('pages')) {
    data += `import {useQuery} from './.pylon/client'

declare module '@getcronit/pylon/pages' {
  interface PageData extends ReturnType<typeof useQuery> {}
}`
  }

  return data
}

const makeTsConfig = async (runtime: Runtime, features: Feature[]) => {
  const data: any = {
    extends: '@getcronit/pylon/tsconfig.pylon.json',
    include: ['pylon.d.ts', 'src/**/*.ts']
  }

  if (runtime === 'cf-workers') {
    data.include.push('worker-configuration.d.ts')
  }

  if (features.includes('pages')) {
    data.compilerOptions = {
      baseUrl: '.',
      paths: {
        '@/*': ['./*']
      },
      jsx: 'react-jsx' // support JSX
    }

    data.include.push('pages', 'components', '.pylon')
  }

  return JSON.stringify(data, null, 2)
}

const injectPagesFeatureFiles = async (
  files: {
    path: string
    content: string
  }[]
) => {
  const pagesFiles = [
    {
      path: 'pages/layout.tsx',
      content: `import '../globals.css'

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
    },
    {
      path: 'pages/page.tsx',
      content: `import { Button } from '@/components/ui/button'
import { PageProps } from '@getcronit/pylon/pages'

const Page: React.FC<PageProps> = props => {
  return (
    <div className="container">
      <title>{props.data.hello}</title>
      <Button>Hello {props.data.hello}</Button>
    </div>
  )
}

export default Page
`
    },
    {
      path: 'globals.css',
      content: `@import 'tailwindcss';

@plugin 'tailwindcss-animate';

@custom-variant dark (&:is(.dark *));

@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));

  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));

  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));

  --color-sidebar: hsl(var(--sidebar-background));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-ring: hsl(var(--sidebar-ring));

  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;

  @keyframes accordion-down {
    from {
      height: 0;
    }
    to {
      height: var(--radix-accordion-content-height);
    }
  }
  @keyframes accordion-up {
    from {
      height: var(--radix-accordion-content-height);
    }
    to {
      height: 0;
    }
  }
}

/*
  The default border color has changed to \`currentColor\` in Tailwind CSS v4,
  so we've added these compatibility styles to make sure everything still
  looks the same as it did with Tailwind CSS v3.

  If we ever want to remove these styles, we need to add an explicit border
  color utility to any element that depends on these defaults.
*/
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-gray-200, currentColor);
  }
}

@layer utilities {
  body {
    font-family: Arial, Helvetica, sans-serif;
  }
}

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
    --radius: 0.5rem;
    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }
  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --card: 0 0% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 9%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --accent: 0 0% 14.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 14.9%;
    --input: 0 0% 14.9%;
    --ring: 0 0% 83.1%;
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
    --sidebar-background: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/*
  ---break---
*/

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`
    },
    {
      path: 'postcss.config.js',
      content: `import tailwindPostCss from '@tailwindcss/postcss'

export default {
  plugins: [tailwindPostCss]
}
`
    },
    {
      path: 'components.json',
      content: `{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}`
    },
    {
      path: 'lib/utils.ts',
      content: `import {clsx, type ClassValue} from 'clsx'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`
    },
    {
      path: 'components/ui/button.tsx',
      content: `import * as React from 'react'
import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'

import {cn} from '@/lib/utils'

const buttonVariants = cva(
  "inline-flexxx items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 ring-ring/10 dark:ring-ring/20 dark:outline-ring/40 outline-ring/50 focus-visible:ring-4 focus-visible:outline-1 aria-invalid:focus-visible:ring-0",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({variant, size, className}))}
      {...props}
    />
  )
}

export {Button, buttonVariants}
`
    }
  ]

  files.push(...pagesFiles)

  // Overwrite the package.json file and add the necessary dependencies

  const packageJsonFile = files.find(file => file.path === 'package.json')

  if (packageJsonFile) {
    const packageJson = JSON.parse(packageJsonFile.content)

    packageJson.dependencies = {
      ...packageJson.dependencies,
      '@gqty/react': '^3.1.0',
      gqty: '^3.4.0',
      '@radix-ui/react-slot': '^1.1.2',
      'class-variance-authority': '^0.7.1',
      clsx: '^2.1.1',
      'lucide-react': '^0.474.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'tailwind-merge': '^3.0.1',
      tailwindcss: '^4.0.4',
      'tailwindcss-animate': '^1.0.7'
    }

    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      '@tailwindcss/postcss': '^4.0.6',
      '@types/react': '^19.0.8'
    }

    packageJsonFile.content = JSON.stringify(packageJson, null, 2)
  }

  return files
}

const injectVariablesInContent = (
  content: string,
  variables: Record<string, string>
) => {
  let result = content

  Object.entries(variables).forEach(([key, value]) => {
    result = result.replaceAll(key, value)
  })

  return result
}

export const createDirectory = async (options: CreateDirectoryOptions) => {
  const {destination, runtime, features} = options

  let runtimeFiles = files.ALL.concat(files[runtime] || []).filter(file => {
    if (!file.specificRuntimes) {
      return true
    }

    return file.specificRuntimes.includes(runtime)
  })

  const indexFile = makeIndexFile(runtime, features)
  const tsConfig = await makeTsConfig(runtime, features)
  const pylonDefinition = await makePylonDefinition(runtime, features)

  runtimeFiles.push(
    {
      path: 'tsconfig.json',
      content: tsConfig
    },
    {
      path: 'pylon.d.ts',
      content: pylonDefinition
    },
    {
      path: 'src/index.ts',
      content: indexFile
    }
  )

  if (features.includes('pages')) {
    runtimeFiles = await injectPagesFeatureFiles(runtimeFiles)
  }

  for (const file of runtimeFiles) {
    const filePath = path.join(destination, file.path)

    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(
      filePath,
      injectVariablesInContent(file.content, options.variables)
    )
  }
}
