import {join} from 'path'

import {setPackageName} from '../utils/set-package-name'
import {getLogger} from '@getcronit/pylon'
import {access} from 'fs/promises'
import {mkdir} from 'fs/promises'
import {constants} from 'fs/promises'

import {detect} from '../utils/detect-pm'

const logger = getLogger()

export default async (
  rootPath: string,
  template: {
    url: string
    branch?: string
  },
  options: {
    name: string
    clientPath?: string
  }
) => {
  await new Promise(resolve => setTimeout(resolve, 100))
  const name = options.name

  logger.info(`🚀 Starting project creation: ${name}`)
  logger.info(`📁 Destination: ${rootPath}`)
  logger.info(`🔖 Template: ${template.url} on branch ${template.branch}`, {
    template
  })

  await new Promise(resolve => setTimeout(resolve, 100))

  // await new Promise(resolve => setTimeout(resolve, 100))

  if (options.clientPath) {
    logger.info(
      `🔧 Client path will be inserted into package.json: ${options.clientPath}`
    )
  }

  try {
    const projectDir = join(process.cwd(), rootPath)

    try {
      await access(projectDir, constants.F_OK)

      throw new Error(
        `Project directory "${name}" already exists in "${rootPath}".`
      )
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err // Re-throw unexpected errors
      }
      // Directory does not exist, continue
    }

    await mkdir(rootPath, {recursive: true})

    logger.info(`Created directory: ${rootPath}`)

    // Clone the template repository into the project directory
    logger.info(`Cloning template from ${template.url} into ${projectDir}`)

    Bun.spawnSync([
      'git',
      'clone',
      template.branch ? '-b' : '',
      template.branch || '',
      template.url,
      projectDir,
      '--single-branch'
    ])

    // Remove the .git directory from the project directory
    logger.info('Removing existing .git directory')
    await Bun.$`rm -rf "${join(projectDir, '.git')}"`

    // Set the project name in the package.json file
    logger.info('Setting project name in package.json')
    setPackageName(projectDir, name)

    // Initialize a new git repository in the project directory
    logger.info('Initializing new git repository')
    await Bun.$`git init "${projectDir}" --initial-branch=main`

    // Add all files to the git repository
    logger.info('Adding files to git repository')
    await Bun.$`git -C "${projectDir}" add .`

    // Create an initial commit
    logger.info('Creating initial commit')
    await Bun.$`git -C "${projectDir}" commit -m "Initial commit"`

    logger.info('Installing project dependencies...')
    // Bun install the project dependencies
    await Bun.$`cd "${projectDir}" && bun install`

    // Insert the client path into the package.json file (gqty key)
    if (options.clientPath) {
      logger.info('Inserting client path into package.json')
      await Bun.$`cd "${projectDir}" && bunx --yes json -q -I -f package.json -e 'this.pylon = this.pylon || {}; this.pylon.gqty="${options.clientPath}"'`

      logger.info('Inserted client path into package.json')

      // Add @gqty/react and gqty to the cwd package.json and prompt the user to install them
      await Bun.$`bunx --yes json -q -I -f package.json -e 'this.devDependencies = this.devDependencies || {}; this.devDependencies["@gqty/react"] = "*"'`

      await Bun.$`bunx --yes json -q -I -f package.json -e 'this.devDependencies = this.devDependencies || {}; this.devDependencies["gqty"] = "*"'`

      const pm = await detect()

      logger.info(
        `Installing GQTy dependencies using the detected package manager: ${pm}`
      )

      if (pm === 'bun') {
        await Bun.$`bun add @gqty/react gqty`
      } else if (pm === 'yarn') {
        await Bun.$`yarn add @gqty/react gqty`
      } else if (pm === 'pnpm') {
        await Bun.$`pnpm add @gqty/react gqty`
      } else {
        await Bun.$`npm install @gqty/react gqty`
      }
    }

    logger.info(`🎉 Project ${name} created successfully at ${projectDir}.`)
  } catch (err: any) {
    throw new Error(`Error creating project: ${err.message}`)
  }
}
