#!/usr/bin/env bun

import {Command} from 'commander'
import {input, select, confirm} from '@inquirer/prompts'
import packageJson from './utils/package-json.js'
import * as commands from './commands/index.js'
import {cliName} from './constants.js'
import {logger} from '@getcronit/pylon'
import * as Sentry from '@sentry/bun'
import path from 'path'

// Set development environment
process.env.NODE_ENV = process.env.NODE_ENV || 'development'

export const program = new Command()

program.name(cliName).description('Pylon CLI').version(packageJson.version)

if (process.env.DISABLE_PYLON_TRACING !== 'true') {
  logger.info(
    `We use Sentry to collect anonymous usage data. This only includes usage of the CLI and NOT your service. If you would like to disable this, set the environment variable DISABLE_PYLON_TRACING=true.`
  )

  Sentry.init({
    dsn: 'https://cb8dd08e25022c115327258343ffb657@sentry.cronit.io/9',
    environment: process.env.NODE_ENV,
    normalizeDepth: 10,
    tracesSampleRate: 1
  })
}

program
  .command('develop')
  .description('Start the development server')
  .option('-p, --port <port>', 'Port to run the server on', '3000')
  .action(commands.develop)

program.command('build').description('Build the pylon').action(commands.build)

const templates: {
  name: string
  description: string
  url: string
  branch?: string
}[] = [
  {
    name: 'Default',
    description: 'Default template',
    url: 'https://github.com/getcronit/pylon-template.git',
    branch: 'beta'
  },
  {
    name: 'Database (Prisma)',
    description: 'Template with Prisma ORM',
    url: 'https://github.com/getcronit/pylon-template.git',
    branch: 'prisma'
  }
]

program
  .command('new')
  .description('Create a new pylon')
  .option('-n, --name <name>', 'Name of the pylon', 'my-pylon')
  .argument('<rootPath>', 'Path to the pylon')
  .argument('[template]', 'Template to use', templates[0].url)
  .action(async (rootPath, template, options) => {
    return await commands.new(
      rootPath,
      {
        url: template
      },
      options
    )
  })

if (!process.argv.slice(2).length) {
  try {
    const answer = await select({
      message: 'What action would you like to take?',
      choices: [
        {name: 'New', value: 'new'},
        {name: 'Develop', value: 'develop'},
        {name: 'Build', value: 'build'}
      ]
    })

    if (answer === 'new') {
      const name = await input({
        message: 'Enter the pylon name',
        default: 'my-pylon'
      })

      const rootPath = await input({
        message: 'Specify the pylon path',
        default: `./${name}`
      })

      const templateIndex = await select({
        message: 'Choose a pylon template',
        choices: templates.map((t, i) => ({name: t.name, value: i}))
      })

      const template = templates[templateIndex]

      const useClient = await confirm({
        message:
          'Would you like to enable an auto-generated client powered by GQty? (https://pylon.cronit.io/docs/client)',
        default: false
      })

      let frontendRoot = ''

      if (useClient) {
        frontendRoot = await input({
          message: 'Enter the path to the frontend root',
          default: '.'
        })
      }

      let clientPath = ''

      if (useClient) {
        clientPath = await input({
          message: 'Enter the path where the client should be generated',
          default: path.join(frontendRoot, 'src', 'gqty')
        })
      }

      // Update the path to be relative to the root path
      clientPath = path.relative(rootPath, clientPath)

      await commands.new(rootPath, template, {
        name,
        client: useClient ? {root: frontendRoot, clientPath} : undefined
      })
    } else if (answer === 'develop') {
      const port = await input({
        message: 'Enter the port number to run the server on',
        default: '3000'
      })

      await commands.develop({port})
    } else if (answer === 'build') {
      await commands.build({})
    }
  } catch (e: any) {
    logger.error(e.toString())
  }
} else {
  program.parse()
}
