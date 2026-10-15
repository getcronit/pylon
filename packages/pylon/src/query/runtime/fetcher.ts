/**
 * The transport. Sends a GraphQL operation to `/graphql`, working in two
 * environments without configuration:
 *
 *  - On the server (inside the bundled Pylon pages SSR), it imports the running
 *    Pylon app and uses its in-process `request` so the GraphQL call never
 *    leaves the process, forwarding the original request's headers (auth, etc).
 *  - In the browser, it falls back to global `fetch` (cookies ride along).
 *
 * This is the same logic that used to live in the generated gqty client
 * template (`build-client.ts`), lifted into the package — minus the
 * non-cloneable-proxy multipart workaround, which is gone because there is no
 * proxy anymore.
 */

export interface FetcherResult<TData = unknown> {
  data?: TData
  errors?: Array<{message: string; [k: string]: unknown}>
}

export interface FetcherOptions {
  endpoint?: string
  fetchOptions?: RequestInit
}

export interface GraphQLRequest {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export async function defaultFetcher<TData = unknown>(
  request: GraphQLRequest,
  options: FetcherOptions = {}
): Promise<FetcherResult<TData>> {
  const {endpoint = '/graphql', fetchOptions} = options
  const headers = new Headers({})
  let fetchToUse: typeof fetch = fetch

  try {
    // 1. Try importing Pylon — if it resolves, we're on the server.
    const moduleNameToPreventBundling = '@getcronit/pylon'
    const {app, getContext} = await import(
      /* @vite-ignore */ moduleNameToPreventBundling
    )
    // Prefer the booted app instance the entry registered, which actually has
    // the GraphQL handler + plugins mounted; fall back to the framework default.
    const serverApp = (globalThis as any).__PYLON_APP__ ?? app
    fetchToUse = serverApp.request.bind(serverApp)

    // 2. Forward the original server request's headers.
    const context = getContext()
    for (const [key, value] of context.req.raw.headers.entries()) {
      headers.append(key, value)
      // Force identity encoding so the internal fetch returns plain JSON.
      headers.set('Accept-Encoding', 'identity')
    }
  } catch {
    // 3. Pylon not importable → browser. Cookies are sent automatically.
  }

  const body = buildGraphQLMultipartForm(
    request.query,
    request.variables ?? {},
    request.operationName
  )

  const response = await fetchToUse(endpoint, {
    method: 'POST',
    headers,
    body,
    mode: 'cors',
    ...fetchOptions
  })

  maybeReloadOnVersionMismatch(response, request.query)

  if (!response.ok && response.status >= 500) {
    throw new Error(`[pylon-query] ${endpoint} responded ${response.status}`)
  }

  return (await response.json()) as FetcherResult<TData>
}

/**
 * If the server reports a different build version than the one the browser
 * booted with, the schema may have changed under us. Reload on reads (never
 * mid-mutation) to pick up the new client.
 */
function maybeReloadOnVersionMismatch(response: Response, query: string): void {
  if (typeof window === 'undefined') return
  // Dev stamps `__PYLON_VERSION__ = 'dev'` on the client while the server sends the
  // content-hashed pages-manifest version — so they ALWAYS differ. Reloading on that would loop
  // forever on any page that refetches on mount (e.g. usePaginatedData's SWR revalidation). This
  // reload is a production deploy signal (pull the new client after a deploy); skip it in dev,
  // where HMR handles updates.
  const clientVersion = (window as any).__PYLON_VERSION__
  if (!clientVersion || clientVersion === 'dev') return
  const serverVersion = response.headers.get('X-Pylon-Version')
  if (serverVersion && serverVersion !== clientVersion) {
    const isMutation = query.trimStart().startsWith('mutation')
    if (!isMutation) window.location.reload()
  }
}

/**
 * GraphQL multipart request spec form builder, with File/Blob extraction.
 * Most operations carry no files, so we only `structuredClone` the variables
 * when we actually have to null a file out.
 */
function buildGraphQLMultipartForm(
  query: string,
  variables: Record<string, unknown>,
  operationName?: string
): FormData {
  const form = new FormData()
  const map: Record<string, string[]> = {}
  const files: (File | Blob)[] = []
  const filePaths: (string | number)[][] = []

  function find(value: unknown, path: (string | number)[] = []): void {
    if (value instanceof File || value instanceof Blob) {
      filePaths.push(path.slice())
      files.push(value)
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => find(item, [...path, i]))
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      Object.entries(value as Record<string, unknown>).forEach(([key, val]) =>
        find(val, [...path, key])
      )
    }
  }
  find(variables)

  const outVars = files.length ? structuredClone(variables) : variables
  filePaths.forEach((path, i) => {
    map[i] = [`variables.${path.join('.')}`]
    setAtPath(outVars, path, null)
  })

  const operations = {query, variables: outVars, operationName}
  form.append('operations', JSON.stringify(operations))
  form.append('map', JSON.stringify(map))
  files.forEach((file, i) => form.append(String(i), file))

  return form
}

function setAtPath(
  obj: unknown,
  path: (string | number)[],
  value: unknown
): void {
  let curr: any = obj
  for (let i = 0; i < path.length - 1; i++) curr = curr[path[i]]
  curr[path[path.length - 1]] = value
}

/**
 * Server-side fetcher bound to a concrete request + app instance.
 *
 * Used by the pages SSR pass instead of `defaultFetcher`: that one relies on
 * Hono's `getContext()` (AsyncLocalStorage), which React's async/streaming
 * render can break out of — so we pass the request and the mounted app
 * explicitly and call the in-process GraphQL handler directly.
 */
export function createServerFetcher(
  app: {request: (input: string, init?: RequestInit) => Promise<Response>},
  baseRequest: {headers: Headers},
  endpoint = '/graphql'
): <TData = unknown>(
  request: GraphQLRequest,
  options?: FetcherOptions
) => Promise<FetcherResult<TData>> {
  return async <TData = unknown>(request: GraphQLRequest) => {
    const headers = new Headers(baseRequest.headers)
    headers.set('Accept-Encoding', 'identity')
    const body = buildGraphQLMultipartForm(
      request.query,
      request.variables ?? {},
      request.operationName
    )
    const response = await app.request(endpoint, {
      method: 'POST',
      headers,
      body
    })
    return (await response.json()) as FetcherResult<TData>
  }
}
