import {readFileSync} from 'fs'
import {resolve} from 'path'

import {__dirname} from './dirname.js'

export interface PackageJson {
  name: string
  version: string
  type: string
  source: string
  exports: object
  main: string
  module: string
  unpkg: string
  scripts: object
  repository: string
  author: string
  license: string
  dependencies: object
  devDependencies: object
}

const getPackageJson = (): PackageJson => {
  return JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))
}

export default getPackageJson()
