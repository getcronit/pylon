#!/usr/bin/env bun

import {Command} from 'commander'

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

program
  .command('new')
  .description('Create a new project')
  .option('-n, --name <name>', 'Name of the project', 'my-pylon-project')
  .argument('<rootPath>', 'Path to the project')
  .argument(
    '[template]',
    'Template to use',
    'https://github.com/getcronit/pylon-template.git'
  )
  .action(commands.new)

program.parse()
