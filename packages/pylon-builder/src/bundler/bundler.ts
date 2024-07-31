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

      // Delete the output directory
      fs.rmdirSync(dir, {recursive: true})

      await Bun.build({
        entrypoints: [inputPath],
        outdir: dir,
        target: 'bun',
        external: Array.from(external),
        sourcemap: 'external',
        packages: 'external'
      })

      // Write GraphQL schema to .pylon/schema.graphql
      const typeDefs = options.getTypeDefs()
      const schemaPath = path.join(dir, 'schema.graphql')

      fs.writeFileSync(schemaPath, typeDefs)

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

  private reportStatus(status: 'start' | 'done'): void {
    if (status === 'start') {
      console.log('\x1b[32m%s\x1b[0m', `Bundling Pylon: ${this.sfiFilePath}...`)
    }

    if (status === 'done') {
      console.log('\x1b[32m%s\x1b[0m', 'Bundling Pylon: done')
    }
  }
}
