// bundler.ts
import fs from 'fs'
import chokidar from 'chokidar'
import {loadPackageJson} from '../load-package-json'
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

      const inputPath = path.join(process.cwd(), this.sfiFilePath)
      const dir = path.join(process.cwd(), this.outputDir)

      await Bun.build({
        entrypoints: [inputPath],
        outdir: dir,
        target: 'bun',
        external: Array.from(external),
        sourcemap: 'inline'
      })

      this.prependSourceMapInstall()

      // attach typeDefs to the output
      this.prependTypeDefs(options.getTypeDefs())

      this.reportStatus('done')
    }

    if (options.watch) {
      const folder = path.dirname(this.sfiFilePath)

      chokidar.watch(folder).on('change', async () => {
        await build()

        if (options.onWatch) {
          options.onWatch()
        }
      })
    }

    await build()
  }

  private prependSourceMapInstall(): void {
    const outputFile = `${this.outputDir}/index.js`

    fs.writeFileSync(
      outputFile,
      `import sourceMapSupport from 'source-map-support'
sourceMapSupport.install()\n` + fs.readFileSync(outputFile)
    )
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
