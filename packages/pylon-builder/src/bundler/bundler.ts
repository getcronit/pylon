// bundler.ts
import fs from 'fs'
import chokidar from 'chokidar'
import {loadPackageJson} from '../load-package-json'
import ncc from '@vercel/ncc'
import path from 'path'

export interface BundlerBuildOptions {
  getTypeDefs: () => string
  watch?: boolean
  onWatch?: () => void
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  public async build(options: BundlerBuildOptions): Promise<void> {
    this.reportStatus('start')

    const build = async () => {
      const external = new Set<string>([
        'hono',
        '@prisma/client',
        'openid-client',
        'hono/http-exception'
      ])

      // Read "external" from package.json
      const packageJson = await loadPackageJson()

      if (packageJson.pylon && packageJson.pylon.external) {
        packageJson.pylon.external.forEach((externalPackage: string) => {
          external.add(externalPackage)
        })
      }

      const nccOptions = {
        quiet: true,
        externals: Array.from(external),
        sourceMap: false, // Generate sourcemap
        transpileOnly: true
      }

      const inputPath = path.join(process.cwd(), this.sfiFilePath)
      const outputPath = path.join(process.cwd(), this.outputDir, 'index.js')

      const {code, map, assets} = await ncc(inputPath, nccOptions)

      //  create folder if not present

      fs.mkdirSync(path.dirname(outputPath), {
        recursive: true
      })

      fs.writeFileSync(outputPath, code)

      // attach typeDefs to the output
      this.appendTypeDefs(options.getTypeDefs())

      this.reportStatus('done')
    }

    if (options.watch) {
      chokidar.watch(this.sfiFilePath).on('change', async () => {
        await build()

        if (options.onWatch) {
          options.onWatch()
        }
      })
    }

    await build()
  }

  private appendTypeDefs(typeDefs: string): void {
    const outputFile = `${this.outputDir}/index.js`

    fs.appendFileSync(
      outputFile,
      `\export const typeDefs = ${JSON.stringify(typeDefs)};`
    )
  }

  private reportStatus(status: 'start' | 'done'): void {
    if (status === 'start') {
      console.log('\x1b[32m%s\x1b[0m', `Bundling Pylon: ${this.sfiFilePath}...`)
    }

    if (status === 'done') {
      console.log('\x1b[32m%s\x1b[0m', 'Bundling Pylon: done')
    }
  }
}
