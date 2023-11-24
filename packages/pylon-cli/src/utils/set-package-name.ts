import {readFileSync, writeFileSync} from 'fs'
import {join} from 'path'

export function setPackageName(projectDir: string, name: string) {
  const pkgJsonPath = join(projectDir, 'package.json')

  // Read the package.json file
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))

  // Update the name field in the package.json file
  pkgJson.name = name

  // Write the updated package.json file
  writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n')
}
