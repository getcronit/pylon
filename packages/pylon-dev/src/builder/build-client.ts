import path from 'path'
import fs from 'fs/promises'
import {generateClient} from '@gqty/cli'
import esbuild from 'esbuild'
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

  await esbuild.build({
    entryPoints: [PYLON_CLIENT_PATH],
    bundle: true,
    outfile: path.join(process.cwd(), '.pylon/client/index.js'),
    packages: 'external',
    format: 'esm',
    platform: 'node'
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
  const headers = new Headers({});
  let fetchToUse: typeof fetch | typeof app.request = fetch

  try {
    // 1. Try importing Pylon — if this works, we're on the server
    const moduleNameToPreventBundling = '@getcronit/pylon'
    const { app, getContext } = await import(moduleNameToPreventBundling)
    fetchToUse = app.request

    // 2. Get headers from the original server request and forward them
    const context = getContext()
    for (const [key, value] of context.req.raw.headers.entries()) {
      headers.append(key, value)
    }
  } catch {
    // 3. Pylon not available — fallback to default fetch (runs in browser)
    // No additional headers are needed; browser sends cookies automatically
  }

  const formData = buildGraphQLMultipartForm(query, variables);

  const response = await fetchToUse('/graphql', {
    method: 'POST',
    headers,
    body: formData,
    mode: 'cors',
    ...fetchOptions
  })

  return await defaultResponseHandler(response)
}

function buildGraphQLMultipartForm(query, variables) {
  const form = new FormData();
  const operations = { query, variables: structuredClone(variables) };
  const map = {};
  const files = [];

  let fileIndex = 0;

  // Helper to find all files in variables
  function recurse(value, path = []) {
    if (value instanceof File || value instanceof Blob) {
      map[fileIndex] = [\`variables.\${path.join(".")}\`];
      set(operations.variables, path, null);
      files.push({ index: fileIndex, file: value });
      fileIndex++;
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => recurse(item, [...path, i]));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, val]) =>
        recurse(val, [...path, key])
      );
    }
  }

  recurse(variables);

  form.append("operations", JSON.stringify(operations));
  form.append("map", JSON.stringify(map));

  files.forEach(({ index, file }) => {
    form.append(index, file);
  });

  return form;
}

// Utility to set a value at a path inside an object
function set(obj, path, value) {
  let curr = obj;
  for (let i = 0; i < path.length - 1; i++) {
    curr = curr[path[i]];
  }
  curr[path[path.length - 1]] = value;
}

export const cache = new Cache(
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

export const pageClient = () => {
  const client = createClient<GeneratedSchema>({
  schema: generatedSchema,
  scalars: scalarsEnumsHash,
  cache: new Cache(
  undefined,
  {
    maxAge: Infinity,
    staleWhileRevalidate: 5 * 60 * 1000,
    normalization: true
  }
),
  fetchOptions: {
    fetcher: queryFetcher
  }
})

const react = createReactClient(client)

return {useQuery: react.useQuery, useHydrateCache: react.useHydrateCache}
}

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
