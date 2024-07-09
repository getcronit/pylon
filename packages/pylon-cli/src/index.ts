#!/usr/bin/env bun

import {Command} from 'commander'
import {input, select, confirm} from '@inquirer/prompts'
import packageJson from './utils/package-json.js'
import * as commands from './commands/index.js'
import {cliName} from './constants.js'

// Set development environment
process.env.NODE_ENV = process.env.NODE_ENV || 'development'

export const program = new Command()

program.name(cliName).description('Pylon CLI').version(packageJson.version)

program
  .command('develop')
  .description('Start the development server')
  .option('-p, --port <port>', 'Port to run the server on', '3000')
  .action(commands.develop)

program
  .command('build')
  .description('Build the application')
  .action(commands.build)

const templates: {
  name: string
  description: string
  url: string
}[] = [
  {
    name: 'Default',
    description: 'Default template',
    url: 'https://github.com/getcronit/pylon-template.git'
  }
]

program
  .command('new')
  .description('Create a new project')
  .option('-n, --name <name>', 'Name of the project', 'my-pylon-project')
  .argument('<rootPath>', 'Path to the project')
  .argument('[template]', 'Template to use', templates[0].url)
  .action(commands.new)

if (!process.argv.slice(2).length) {
  ;(async () => {
    const answer = await select({
      message: 'What do you want to do?',
      choices: [
        {name: 'New', value: 'new'},
        {name: 'Develop', value: 'develop'},
        {name: 'Build', value: 'build'}
      ]
    })

    if (answer === 'new') {
      const name = await input({
        message: 'Name of the project',
        default: 'my-pylon-project'
      })

      const rootPath = await input({
        message: 'Path to the project',
        default: `./${name}`
      })

      const template = await select({
        message: 'Select a template',
        choices: templates.map(t => ({name: t.name, value: t.url}))
      })

      const useClient = await confirm({
        message:
          'Do you want to enable a auto-generated client? (https://pylon.cronit.io/docs/client)',
        default: false
      })

      let clientPath: string | undefined = undefined
      if (useClient) {
        clientPath = await input({
          message: 'Path to the client (relative to the pylon project)',
          default: '../src/client/index.ts'
        })
      }

      await commands.new(rootPath, template, {name, clientPath})
    } else if (answer === 'develop') {
      const port = await input({
        message: 'Port to run the server on',
        default: '3000'
      })

      await commands.develop({port})
    } else if (answer === 'build') {
      await commands.build({})
    }
  })()
} else {
  program.parse()
}
