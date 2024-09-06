#!/usr/bin/env node

import {Option, program, type Command} from 'commander'
import {version} from '../package.json'
import consola from 'consola'
import {input, select, confirm} from '@inquirer/prompts'
import path from 'path'
import * as fs from 'fs'

function mkdirp(dir: string) {
  try {
    fs.mkdirSync(dir, {recursive: true})
  } catch (e) {
    if (e instanceof Error) {
      if ('code' in e && e.code === 'EEXIST') return
    }
    throw e
  }
}

const runtimes: {
  key: string
  name: string
  website: string
  templates?: string[]
}[] = [
  {
    key: 'bun',
    name: 'Bun.js',
    website: 'https://bunjs.dev',
    templates: ['default']
  },
  {
    key: 'node',
    name: 'Node.js',
    website: 'https://nodejs.org',
    templates: ['default']
  },
  {
    key: 'cf-workers',
    name: 'Cloudflare Workers',
    website: 'https://workers.cloudflare.com',
    templates: ['default']
  }
]

const templates: {
  key: string
  name: string
  description: string
}[] = [
  {
    key: 'default',
    name: 'Default',
    description: 'Default template'
  },
  {
    key: 'database',
    name: 'Database (Prisma)',
    description: 'Template with Prisma ORM'
  }
]

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
const readdirFilesSyncRecursive = (dir: string): string[] => {
  const run = (dir: string): string[] => {
    const result: string[] = []

    const files = fs.readdirSync(dir)

    files.forEach(file => {
      const filePath = path.join(dir, file)

      if (
        fs.statSync(filePath).isDirectory() &&
        !filePath.includes('node_modules')
      ) {
        result.push(...run(filePath))
      }

      // Only add files
      if (fs.statSync(filePath).isFile()) {
        result.push(filePath)
      }
    })

    return result
  }

  return run(dir).map(file => {
    return file.replace(dir, '.')
  })
}

const createTemplate = async (options: {
  name: string
  runtime: string
  template: string
  target: string
}) => {
  const {runtime, template, target} = options

  const runtimeName = runtimes.find(({key}) => key === runtime)?.name
  const templateName = templates.find(({key}) => key === template)?.name

  if (!runtimeName) {
    throw new Error(`Invalid runtime: ${runtime}`)
  }

  if (!templateName) {
    throw new Error(`Invalid template: ${template}`)
  }

  // The templates are stored in the `templates` directory
  const sharedTemplateDir = path.join(__dirname, '..', 'templates', 'shared')

  if (!fs.existsSync(sharedTemplateDir)) {
    throw new Error(`Shared templates not found: ${sharedTemplateDir}`)
  }

  const templateDir = path.join(__dirname, '..', 'templates', runtime, template)

  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template not found: ${templateDir}`)
  }

  // The target directory is already created
  const targetDirectoryPath = path.join(process.cwd(), target)

  consola.start(`Creating pylon in ${targetDirectoryPath}`)

  const inject = (content: string) => {
    return injectVariablesInContent(content, {
      __PYLON_NAME__: options.name
    })
  }

  // Copy the shared template files
  readdirFilesSyncRecursive(sharedTemplateDir).forEach(file => {
    const source = path.join(sharedTemplateDir, file)
    const target = path.join(targetDirectoryPath, file)

    // Create folder recursively and copy file

    const targetDir = path.dirname(target)

    // Skip the .github/workflows directory for cf-workers runtime
    if (
      runtime === 'cf-workers' &&
      source.includes('.github/workflows/publish.yaml')
    ) {
      return
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, {recursive: true})
    }

    const injectedContent = inject(fs.readFileSync(source, 'utf-8'))

    fs.writeFileSync(target, injectedContent)
  })

  // Copy the runtime specific template files
  readdirFilesSyncRecursive(templateDir).forEach(file => {
    const source = path.join(templateDir, file)
    const target = path.join(targetDirectoryPath, file)

    // Create folder recursively and copy file
    const targetDir = path.dirname(target)

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, {recursive: true})
    }

    const injectedContent = inject(fs.readFileSync(source, 'utf-8'))

    fs.writeFileSync(target, injectedContent)
  })

  consola.success(`Pylon created`)
}

import {detect} from 'detect-package-manager'
import {spawnSync} from 'child_process'

const installDependencies = async (args: {
  target: string
  packageManager?: string
}) => {
  const target = path.resolve(args.target)

  console.log('target', target)

  if (!args.packageManager) {
    args.packageManager = await detect({
      cwd: target,
      includeGlobalBun: true
    })
  }

  if (!args.packageManager) {
    throw new Error('No package manager found')
  }

  // yarn', 'npm', or 'pnpm', 'bun'
  const {packageManager} = args

  let command = ''

  switch (packageManager) {
    case 'yarn':
      command = 'yarn'
      break
    case 'npm':
      command = 'npm install'
      break
    case 'pnpm':
      command = 'pnpm install'
      break
    case 'bun':
      command = 'bun install'
      break
    default:
      throw new Error(`Invalid package manager: ${packageManager}`)
  }

  consola.start(`Installing dependencies using ${packageManager}`)

  const proc = spawnSync(command, {
    cwd: target,
    shell: true,
    stdio: 'inherit'
  })

  if (proc.status !== 0) {
    throw new Error(`Failed to install dependencies`)
  }

  consola.success(`Dependencies installed`)
}

program
  .name('create-pylon')
  .version(version)
  .arguments('[target]')
  .addOption(new Option('-i, --install', 'Install dependencies'))
  .addOption(
    new Option('-r, --runtime <runtime>', 'Runtime').choices(
      runtimes.map(({key}) => key)
    )
  )
  .addOption(new Option('-t, --template <template>', 'Template'))
  .addOption(
    new Option('-pm, --package-manager <packageManager>', 'Package manager')
  )
  .addOption(
    new Option(
      '--client',
      'Enable client generation (https://pylon.cronit.io/docs/integrations/gqty)'
    )
  )
  .addOption(new Option('--client-path <clientPath>', 'Client path'))
  .addOption(new Option('--client-port <clientPort>', 'Client port'))
  .action(main)

type ArgOptions = {
  install: boolean
  runtime: string
  template: string
  packageManager?: string
  client?: boolean
  clientPath?: string
  clientPort?: string
}

async function main(
  targetDir: string | undefined,
  options: ArgOptions,
  command: Command
) {
  try {
    consola.log(`${command.name()} version ${command.version()}`)

    const {
      install: installArg,
      runtime: runtimeArg,
      template: templateArg,
      packageManager: packageManagerArg,
      client: clientArg,
      clientPath: clientPathArg,
      clientPort: clientPortArg
    } = options

    let target = ''

    if (targetDir) {
      target = targetDir

      consola.success(`Using target directory … ${target}`)
    } else {
      const answer = await input({
        message: 'Target directory',
        default: 'my-pylon'
      })
      target = answer
    }

    let projectName = ''

    if (target === '.') {
      projectName = path.basename(process.cwd())
    } else {
      projectName = path.basename(target)
    }

    const runtimeName =
      runtimeArg ||
      (await select({
        message: 'Which runtime would you like to use?',
        choices: runtimes.map(runtime => ({
          name: `${runtime.name} (${runtime.website})`,
          value: runtime.key
        })),
        default: 0
      }))

    if (!runtimeName) {
      throw new Error('No runtime selected')
    }

    const runtime = runtimes.find(({key}) => key === runtimeName)

    if (!runtime) {
      throw new Error(`Invalid runtime selected: ${runtimeName}`)
    }

    const templateName =
      templateArg ||
      (await select({
        message: 'Which template would you like to use?',
        choices: templates
          .filter(template => runtime.templates?.includes(template.key))
          .map(template => ({
            name: template.name,
            value: template.key
          })),
        default: 0
      }))

    if (!templateName) {
      throw new Error('No template selected')
    }

    if (fs.existsSync(target)) {
      if (fs.readdirSync(target).length > 0) {
        const response = await confirm({
          message: 'Directory not empty. Continue?',
          default: false
        })
        if (!response) {
          process.exit(1)
        }
      }
    } else {
      mkdirp(target)
    }

    const install =
      installArg ||
      (await confirm({message: 'Would you like to install dependencies?'}))

    await createTemplate({
      name: projectName,
      runtime: runtimeName,
      template: templateName,
      target
    })

    let packageManager = packageManagerArg

    if (runtimeName === 'bun' && !packageManager) {
      packageManager = 'bun'
    }

    if (install) {
      await installDependencies({target, packageManager})
    }

    const client =
      clientArg ||
      (await confirm({
        message:
          'Would you like to enable client generation? (https://pylon.cronit.io/docs/integrations/gqty)',
        default: false
      }))

    if (client) {
      let clientRoot: string = ''
      let clientPath: string = ''
      if (!clientPathArg) {
        clientRoot = await input({
          message: 'Path to the root where the client should be generated',
          default: '.'
        })

        clientPath = await input({
          message: 'Path to generate the client to',
          default: path.join(clientRoot, 'gqty/index.ts'),
          validate: value => {
            // Check if the path starts with the client root (take care of .)
            if (!value.startsWith(clientRoot === '.' ? '' : clientRoot)) {
              return 'Path must start with the client root'
            }

            return true
          }
        })
      }

      const clientPort =
        clientPortArg ||
        (await input({
          message: 'Port of the pylon server to generate the client from',
          default: '3000'
        }))

      consola.start(`Updating pylon dev script to generate client`)

      const devScriptPath = path.join(target, 'package.json')

      const devScript = JSON.parse(fs.readFileSync(devScriptPath, 'utf-8'))

      devScript.scripts = {
        ...devScript.scripts,
        dev:
          devScript.scripts.dev +
          ` --client --client-port ${clientPort} --client-path ${clientPath}`
      }

      fs.writeFileSync(devScriptPath, JSON.stringify(devScript, null, 2))

      consola.success(`Pylon dev script updated`)
    }

    consola.box(`Pylon successfully created in ${target}.\n\nHappy coding!`)
  } catch (e) {
    consola.error(e)
  }
}

program.parse()
