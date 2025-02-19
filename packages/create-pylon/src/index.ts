#!/usr/bin/env node

import chalk from 'chalk'
import {Option, program, type Command} from 'commander'
import consola from 'consola'
import * as fs from 'fs'
import path from 'path'

import {dirname} from 'path'
import {fileURLToPath} from 'url'

import {createDirectory, features, runtimes} from './create-directory'
import {
  detectPackageManager,
  getRunScript,
  installPackage,
  PackageManager
} from './install-pkg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const version = (() => {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
  ).version as string
})()

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
  .addOption(
    new Option('--features [features...]', 'Features').choices(
      features.map(({key}) => key)
    )
  )
  .addOption(
    new Option('-pm, --package-manager <packageManager>', 'Package manager')
  )
  .action(main)

type ArgOptions = {
  install?: boolean
  runtime: string
  features: string[]
  packageManager?: PackageManager
}

async function main(
  targetDir: string | undefined,
  options: ArgOptions,
  command: Command
) {
  consola.log(`${command.name()} version ${command.version()}`)

  try {
    if (!targetDir) {
      const answer = await consola.prompt(
        'Where should the project be created?',
        {
          default: './my-pylon',
          placeholder: './my-pylon',
          cancel: 'reject'
        }
      )
      targetDir = answer
    }

    let projectName = ''

    if (targetDir === '.') {
      projectName = path.basename(process.cwd())
    } else {
      projectName = path.basename(targetDir)
    }

    if (!options.runtime) {
      const answer = await consola.prompt('Select a runtime environment:', {
        type: 'select',
        options: runtimes.map(r => ({
          label: r.name,
          value: r.key,
          hint: r.website
        })),
        cancel: 'reject'
      })
      options.runtime = answer
    }

    const runtime = runtimes.find(r => r.key === options.runtime)

    if (!runtime) {
      throw new Error(`Invalid runtime selected: ${options.runtime}`)
    }

    if (!options.features) {
      const answer = await consola.prompt('Configure features:', {
        type: 'multiselect',
        options: features
          .filter(f => runtime.supportedFeatures?.includes(f.key))
          .map(f => ({
            label: f.name,
            value: f.key,
            hint: f.website
          })),
        required: false,
        cancel: 'reject'
      })
      options.features = answer as any
    }

    // Check if options.features is valid
    for (const feature of options.features) {
      if (!runtime.supportedFeatures?.includes(feature)) {
        throw new Error(`Invalid feature selected: ${feature}`)
      }
    }

    // Summary of the selected options
    const confirmCreation = await consola.prompt(
      `Ready to create the project in ${chalk.blue(targetDir)}?`,
      {
        type: 'confirm',
        initial: true,
        cancel: 'reject'
      }
    )

    if (!confirmCreation) {
      const error = new Error('Prompt cancelled.')
      error.name = 'ConsolaPromptCancelledError'
      throw error
    }

    if (fs.existsSync(targetDir)) {
      if (fs.readdirSync(targetDir).length > 0) {
        const response = await consola.prompt(
          'Directory not empty. Continue?',
          {
            type: 'confirm',
            cancel: 'reject'
          }
        )
        if (!response) {
          const error = new Error('Prompt cancelled.')
          error.name = 'ConsolaPromptCancelledError'
          throw error
        }
      }
    }

    await createDirectory({
      variables: {
        __PYLON_NAME__: projectName
      },
      runtime: runtime.key,
      features: options.features,
      destination: targetDir
    })

    const packageManager =
      options.packageManager || (await detectPackageManager(targetDir))

    if (options.install === undefined) {
      options.install = await consola.prompt(
        `Installed dependencies with ${packageManager} now? You can also do this later.`,
        {
          type: 'confirm',
          initial: true,
          cancel: 'reject'
        }
      )
    }

    if (options.install) {
      await installPackage([])
    }

    const runScript = getRunScript(packageManager)

    const message = `
    🎉 ${chalk.green.bold('Pylon created successfully.')}
  
    💻 ${chalk.cyan.bold('Continue Developing')}
        ${chalk.yellow('Change directories:')} cd ${chalk.blue(targetDir)}
        ${chalk.yellow('Start dev server:')} ${runScript} dev
        ${
          runtime.key === 'cf-workers'
            ? `${chalk.yellow('Deploy:')} ${runScript} deploy`
            : ''
        }
  
    📖 ${chalk.cyan.bold('Explore Documentation')}
        ${chalk.underline.blue('https://pylon.cronit.io/docs')}
  
    💬 ${chalk.cyan.bold('Join our Community')}
        ${chalk.underline.blue('https://discord.gg/cbJjkVrnHe')}
    `

    consola.box(message)
  } catch (e) {
    consola.error(e)
  }
}

program.parse()
