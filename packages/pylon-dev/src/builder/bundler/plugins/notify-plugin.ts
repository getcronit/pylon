import {Plugin} from 'esbuild'
import path from 'path'
import fs from 'fs/promises'
import consola from 'consola'

export interface NotifyPluginOptions {
  onBuild?: (output: {
    totalFiles: number
    totalSize: number
    schemaChanged: boolean
    duration: number
  }) => Promise<void> | void
  dir: string
}

export const notifyPlugin = ({dir, onBuild}: NotifyPluginOptions): Plugin => ({
  name: 'notify',
  async setup(build) {
    const loadSchema = async () => {
      const schemaPath = path.join(dir, 'schema.graphql')

      try {
        await fs.access(schemaPath)
      } catch {
        return null
      }

      return await fs.readFile(schemaPath, 'utf-8')
    }

    let cachedSchema: string | null = await loadSchema()

    let startTime = Date.now()
    build.onStart(async () => {
      startTime = Date.now()
      consola.start('[Pylon]: Building...')
    })

    build.onEnd(async result => {
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          consola.error(`[Pylon]: ${error.text}
${
  error.location
    ? `at ${error.location.file}:${error.location.line}:${error.location.column}`
    : ''
}
${error.detail ? error.detail : ''}`)
        }

        throw new Error('Failed to build Pylon')
      }

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          consola.warn(warning)
        }
      }

      const duration = Date.now() - startTime

      const totalFiles = Object.keys(result.metafile!.inputs).length

      const totalSize = Object.values(result.metafile!.outputs).reduce(
        (acc, output) => acc + output.bytes,
        0
      )

      const latestSchema = await loadSchema()

      consola.success(`[Pylon]: Built in ${duration}ms`)

      const schemaChanged = latestSchema !== cachedSchema

      if (schemaChanged) {
        consola.info('[Pylon]: Schema updated')

        cachedSchema = latestSchema
      }

      if (onBuild) {
        await onBuild({
          totalFiles,
          totalSize,
          schemaChanged,
          duration
        })
      }
    })
  }
})
