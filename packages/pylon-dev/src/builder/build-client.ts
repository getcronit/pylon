import path from 'path'
import fs from 'fs/promises'
import {generateClient} from '@gqty/cli'
import {buildSchema} from 'graphql'
import {updateFileIfChanged} from './update-file-if-changed'

const PYLON_SCHEMA_PATH = path.join(process.cwd(), '.pylon/schema.graphql')
const PYLON_CLIENT_PATH = path.join(process.cwd(), '.pylon/client/index.ts')

export interface BuildClientOptions {
  /**
   * Client will be generated if the schema has changed or if the client does not exist
   */
  schemaChanged: boolean
}

export const buildClient = async ({schemaChanged}: BuildClientOptions) => {
  // Check if the schema exists

  try {
    await fs.access(PYLON_SCHEMA_PATH)
  } catch (e) {
    throw new Error(
      'Schema not found. Please run `pylon build` or `pylon dev` first.'
    )
  }

  // Check if the client exists
  if (!schemaChanged) {
    // If the schema has not changed, we need to check if the client exists
    try {
      await fs.access(PYLON_CLIENT_PATH)
      return
    } catch (e) {
      // If the client does not exist, we need to generate it
    }
  }

  const schema = await fs.readFile(PYLON_SCHEMA_PATH, 'utf-8')

  const schemaObj = buildSchema(schema)

  // Write the custom client index file because the default one is not compatible with Pylon
  await fs.mkdir(path.dirname(PYLON_CLIENT_PATH), {recursive: true})
  await updateFileIfChanged(PYLON_CLIENT_PATH, customClientIndex)

  await generateClient(schemaObj, {
    endpoint: 'will-be-overwritten',
    frameworks: ['react'],
    destination: PYLON_CLIENT_PATH,
    react: true,
    scalarTypes: {
      Number: 'number',
      Object: 'Record<string, unknown>'
    }
  })
}

const customClientIndex = `/**
 * GQty: You can safely modify this file based on your needs.
 */

import {createReactClient} from '@gqty/react'
import {
  Cache,
  createClient,
  defaultResponseHandler,
  type QueryFetcher
} from 'gqty'
import {
  generatedSchema,
  scalarsEnumsHash,
  type GeneratedSchema
} from './schema.generated'

const queryFetcher: QueryFetcher = async function (
  {query, variables, operationName},
  fetchOptions
) {
  let browserOrInternalFetch: typeof fetch | typeof app.request = fetch

  try {
    const moduleNameToPreventBundling = '@getcronit/pylon'
    const {app} = await import(moduleNameToPreventBundling)

    browserOrInternalFetch = app.request
  } catch (error) {
    // Pylon is not found. Maybe we are running in a different environment.
  }

  const response = await browserOrInternalFetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables,
      operationName
    }),
    mode: 'cors',
    ...fetchOptions
  })

  return await defaultResponseHandler(response)
}

const cache = new Cache(
  undefined,
  /**
   * Default option is immediate cache expiry but keep it for 5 minutes,
   * allowing soft refetches in background.
   */
  {
    maxAge: Infinity,
    staleWhileRevalidate: 5 * 60 * 1000,
    normalization: true
  }
)

export const client = createClient<GeneratedSchema>({
  schema: generatedSchema,
  scalars: scalarsEnumsHash,
  cache,
  fetchOptions: {
    fetcher: queryFetcher
  }
})

// Core functions
export const {resolve, subscribe, schema} = client

// Legacy functions
export const {query, mutation, mutate, subscription, resolved, refetch, track} =
  client

export const {
  graphql,
  useQuery,
  usePaginatedQuery,
  useTransactionQuery,
  useLazyQuery,
  useRefetch,
  useMutation,
  useMetaState,
  prepareReactRender,
  useHydrateCache,
  prepareQuery
} = createReactClient<GeneratedSchema>(client, {
  defaults: {
    // Enable Suspense, you can override this option for each hook.
    suspense: false
  }
})

export * from './schema.generated'`
