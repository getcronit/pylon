import {execSync} from 'child_process'
import {existsSync, mkdirSync} from 'fs'
import {join} from 'path'

import {setPackageName} from '../utils/set-package-name'

export default async (
  rootPath: string,
  template: string,
  options: {
    name: string
    clientPath?: string
  }
) => {
  const name = options.name

  console.log(
    `Creating project ${name} at ${rootPath} from template ${template}`
  )

  // Check if the project directory already exists
  const projectDir = join(process.cwd(), rootPath)
  if (existsSync(projectDir)) {
    console.error(
      `Error: Project directory "${name}" already exists in "${rootPath}".`
    )
    process.exit(1)
  } else {
    mkdirSync(rootPath, {recursive: true})
  }

  // Clone the template repository into the project directory
  execSync(`git clone ${template} "${projectDir}"`)

  // Remove the .git directory from the project directory
  execSync(`rm -rf "${join(projectDir, '.git')}"`)

  // Set the project name in the package.json file
  setPackageName(projectDir, name)

  // Initialize a new git repository in the project directory
  execSync(`git init "${projectDir}"`)

  // Add all files to the git repository
  execSync(`git -C "${projectDir}" add .`)

  // Create an initial commit
  execSync(`git -C "${projectDir}" commit -m "Initial commit"`)

  console.log('Installing project dependencies...')

  // Bun install the project dependencies
  execSync(`cd "${projectDir}" && bun install`, {
    stdio: 'inherit'
  })

  // Insert the client path into the package.json file (gqty key)
  if (options.clientPath) {
    execSync(
      `cd "${projectDir}" && npx json -q -I -f package.json -e 'this.pylon = this.pylon || {}; this.pylon.gqty="${options.clientPath}"'`
    )

    console.log('Inserted client path into package.json')
  }

  console.log(`Project ${name} created successfully at ${projectDir}.`)
}
