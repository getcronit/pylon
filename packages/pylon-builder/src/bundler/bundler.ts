import fs from 'fs'
import chokidar from 'chokidar'

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

  public async build(options: BundlerBuildOptions) {
    this.reportStatus('start')

    const build = async () => {
      const external = new Set<string>(['hono'])

      // Read "external" from package.json
      const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'))

      if (packageJson.pylon && packageJson.pylon.external) {
        packageJson.pylon.external.forEach((externalPackage: string) => {
          external.add(externalPackage)
        })
      }

      await Bun.build({
        entrypoints: [this.sfiFilePath],
        outdir: this.outputDir,
        target: 'bun',
        external: Array.from(external)
      })

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

  private appendTypeDefs(typeDefs: string) {
    const outputFile = this.outputDir + '/index.js'

    fs.appendFileSync(
      outputFile,
      `\export const typeDefs = ${JSON.stringify(typeDefs)};`
    )
  }

  private reportStatus(status: 'start' | 'done') {
    if (status === 'start') {
      console.log('\x1b[32m%s\x1b[0m', `Bundling Pylon: ${this.sfiFilePath}...`)
    }

    if (status === 'done') {
      console.log('\x1b[32m%s\x1b[0m', 'Bundling Pylon: done')
    }
  }
}
