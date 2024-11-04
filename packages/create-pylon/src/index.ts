#!/usr/bin/env node

import {Option, program, type Command} from 'commander'
import consola from 'consola'
import {input, select, confirm} from '@inquirer/prompts'
import path from 'path'
import chalk from 'chalk'
import * as fs from 'fs'

import * as telemetry from '@getcronit/pylon-telemetry'

import {fileURLToPath} from 'url'
import {dirname} from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const version = (() => {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
  ).version as string
})()

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
  },
  {
    key: 'deno',
    name: 'Deno',
    website: 'https://deno.land',
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

      if (fs.statSync(filePath).isDirectory()) {
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
    let target = path.join(targetDirectoryPath, file)

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

    // If the target ends with `.example`, remove the suffix.
    // This is useful for `.gitignore.example` files because they are not published in
    // the `create-pylon` package when named `.gitignore`.
    if (target.endsWith('.example')) {
      target = target.replace('.example', '')
    }

    const injectedContent = inject(fs.readFileSync(source, 'utf-8'))

    fs.writeFileSync(target, injectedContent)
  })

  // Copy the runtime specific template files
  readdirFilesSyncRecursive(templateDir).forEach(file => {
    const source = path.join(templateDir, file)
    let target = path.join(targetDirectoryPath, file)

    // Create folder recursively and copy file
    const targetDir = path.dirname(target)

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, {recursive: true})
    }

    // If the target ends with `.example`, remove the suffix.
    // This is useful for `.gitignore.example` files because they are not published in
    // the `create-pylon` package when named `.gitignore`.
    if (target.endsWith('.example')) {
      target = target.replace('.example', '')
    }

    const injectedContent = inject(fs.readFileSync(source, 'utf-8'))

    fs.writeFileSync(target, injectedContent)
  })

  consola.success(`Pylon created`)
}

import {spawnSync} from 'child_process'
import {detectPackageManager, getRunScript, PackageManager} from './detect-pm'

const installDependencies = async (args: {
  target: string
  packageManager: PackageManager
}) => {
  const target = path.resolve(args.target)
  const packageManager = args.packageManager

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
    case 'deno':
      command = 'deno install'
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
  packageManager?: PackageManager
  client?: boolean
  clientPath?: string
  clientPort?: string
}

const getPreferredPmByRuntime = (
  runtime: string
): PackageManager | undefined => {
  if (runtime === 'bun') {
    return 'bun'
  } else if (runtime === 'deno') {
    return 'deno'
  }
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

    const packageManager = detectPackageManager({
      preferredPm: getPreferredPmByRuntime(runtime.key),
      cwd: target
    })

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

    let clientRoot: string = ''
    let clientPath: string = ''
    let clientPort: string = ''

    if (client) {
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

      clientPort =
        clientPortArg ||
        (await input({
          message: 'Port of the pylon server to generate the client from',
          default: '3000'
        }))

      consola.start(`Updating pylon dev script to generate client`)

      let packagePath: string
      let scriptKey: string
      if (runtime.key === 'deno') {
        packagePath = path.join(target, 'deno.json')
        scriptKey = 'tasks'
      } else {
        packagePath = path.join(target, 'package.json')
        scriptKey = 'scripts'
      }

      const devScript = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))

      devScript[scriptKey] = {
        ...devScript[scriptKey],
        dev:
          devScript[scriptKey].dev +
          ` --client --client-port ${clientPort} --client-path ${clientPath}`
      }

      fs.writeFileSync(packagePath, JSON.stringify(devScript, null, 2))

      consola.success(`Pylon dev script updated`)
    }

    const runScript = getRunScript(packageManager)

    const message = `
🎉 ${chalk.green.bold('Pylon created successfully.')}

💻 ${chalk.cyan.bold('Continue Developing')}
    ${chalk.yellow('Change directories:')} cd ${chalk.blue(target)}
    ${chalk.yellow('Start dev server:')} ${runScript} dev
    ${chalk.yellow('Deploy:')} ${runScript} deploy

📖 ${chalk.cyan.bold('Explore Documentation')}
    ${chalk.underline.blue('https://pylon.cronit.io/docs')}

💬 ${chalk.cyan.bold('Join our Community')}
    ${chalk.underline.blue('https://discord.gg/cbJjkVrnHe')}
`

    await telemetry.sendCreateEvent({
      name: projectName,
      pylonCreateVersion: version,
      runtime: runtimeName,
      template: templateName,
      clientPath: clientPath || undefined,
      clientPort: parseInt(clientPort) || undefined
    })

    consola.box(message)
  } catch (e) {
    consola.error(e)
  }
}

program.parse()
