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
        '@getcronit/pylon',
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
        sourceMap: true, // Generate sourcemap
        transpileOnly: true
      }

      const inputPath = path.join(process.cwd(), this.sfiFilePath)
      const dir = path.join(process.cwd(), this.outputDir)

      const {code, map, assets} = await ncc(inputPath, nccOptions)

      fs.mkdirSync(dir, {
        recursive: true
      })

      fs.writeFileSync(`${dir}/index.js`, code)

      Object.entries(assets).forEach(([name, asset]) => {
        const source = (asset as any).source

        if (typeof source === 'string') {
          fs.writeFileSync(`${dir}/${name}`, source)
        } else if (typeof source === 'object') {
          fs.writeFileSync(`${dir}/${name}`, Buffer.from(source))
        }
      })

      // attach typeDefs to the output
      this.prependTypeDefs(options.getTypeDefs())

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

  private prependTypeDefs(typeDefs: string): void {
    const outputFile = `${this.outputDir}/index.js`

    fs.writeFileSync(
      outputFile,
      `\export const typeDefs = ${JSON.stringify(typeDefs)};\n` +
        fs.readFileSync(outputFile)
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
