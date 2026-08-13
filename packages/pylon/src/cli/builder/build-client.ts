import {generateClientFiles} from '@getcronit/pylon/query/build'
import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import {updateFileIfChanged} from './update-file-if-changed'

const PYLON_SCHEMA_PATH = path.join(process.cwd(), '.pylon/schema.graphql')
const PYLON_CLIENT_DIR = path.join(process.cwd(), '.pylon/client')
const PYLON_CLIENT_INDEX = path.join(PYLON_CLIENT_DIR, 'index.ts')
const PYLON_CLIENT_TYPES = path.join(PYLON_CLIENT_DIR, 'types.ts')

export interface BuildClientOptions {
  /**
   * Client is regenerated if the schema changed or if the client doesn't exist.
   */
  schemaChanged: boolean
}

/**
 * Generate the typed pylon-query client from the build's SDL. Replaces the old
 * gqty `generateClient` pipeline: no proxy client, no gqty codegen — just a
 * descriptor-driven client plus the authoring `Data` root type.
 */
export const buildClient = async ({schemaChanged}: BuildClientOptions) => {
  try {
    await fs.access(PYLON_SCHEMA_PATH)
  } catch {
    throw new Error(
      'Schema not found. Please run `pylon build` or `pylon dev` first.'
    )
  }

  if (!schemaChanged) {
    try {
      await fs.access(path.join(PYLON_CLIENT_DIR, 'index.js'))
      return
    } catch {
      // client missing → (re)generate
    }
  }

  const sdl = await fs.readFile(PYLON_SCHEMA_PATH, 'utf-8')

  const {indexTs, typesTs} = generateClientFiles(sdl, {
    scalarTypes: {
      Number: 'number',
      JSONObject: 'Record<string, unknown>'
    }
  })

  await fs.mkdir(PYLON_CLIENT_DIR, {recursive: true})
  await updateFileIfChanged(PYLON_CLIENT_TYPES, typesTs)
  await updateFileIfChanged(PYLON_CLIENT_INDEX, indexTs)

  await esbuild.build({
    entryPoints: [PYLON_CLIENT_INDEX],
    bundle: true,
    outfile: path.join(PYLON_CLIENT_DIR, 'index.js'),
    packages: 'external',
    format: 'esm',
    platform: 'node'
  })
}
