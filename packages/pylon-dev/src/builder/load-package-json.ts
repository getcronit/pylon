import path from 'path'
import {readFile} from 'fs/promises'

export async function loadPackageJson(): Promise<{
  baseURL?: string
  pylon?: {
    external?: string[]
  }
}> {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json')

  const file = await readFile(packageJsonPath)
  const packageJson = JSON.parse(file.toString())
  return packageJson
}
