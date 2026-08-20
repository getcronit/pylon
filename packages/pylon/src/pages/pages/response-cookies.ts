/**
 * Setting cookies from inside an SSR render.
 *
 * This works only because the render is fully BUFFERED: `usePages` collects
 * `renderToReadableStream` to a string and only then builds the response with
 * `c.html(html)`. So the tree can write into a collector during render and the handler can
 * flush it into response headers afterwards. (If SSR ever moves to true streaming, this API
 * breaks by construction — see rfcs/SSR_REQUEST_CONTEXT.md.)
 *
 * An ambient Next-style `cookies()` is not possible here: React's async render breaks out of
 * AsyncLocalStorage, which is the same reason the per-request GraphQL fetcher is threaded
 * rather than ambient. So the collector rides the existing provider.
 *
 * ## Keyed by name, deliberately
 *
 * The SSR handler renders TWICE on the error path — once to discover the thrown
 * error/Response, then again with the populated error context so the boundary renders. An
 * append-style collector would emit duplicate `Set-Cookie` headers for that request. A Map
 * keyed by cookie name makes the second render overwrite rather than append, so re-rendering
 * is naturally idempotent.
 *
 * ## Contract
 *
 * Writing during render is a side effect, and React may render a component more than once.
 * This is safe for "set this cookie to this computed value" and unsafe for anything
 * order-dependent — counters, appends, or values derived from how many times you ran.
 */

export interface ResponseCookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None' | 'strict' | 'lax' | 'none'
  partitioned?: boolean
}

/** One pending write. `value: null` means delete. */
export interface ResponseCookieEntry {
  name: string
  value: string | null
  options: ResponseCookieOptions
}

export interface ResponseCookies {
  /** Queue a cookie on the SSR response. Last write for a given name wins. */
  set(name: string, value: string, options?: ResponseCookieOptions): void
  /** Queue a deletion (expires the cookie). Last write for a given name wins. */
  delete(name: string, options?: Pick<ResponseCookieOptions, 'path' | 'domain'>): void
  /** @internal — drained by the SSR handler after the render completes. */
  entries(): ResponseCookieEntry[]
}

/** Server-side collector. One per request. */
export const createResponseCookies = (): ResponseCookies => {
  const pending = new Map<string, ResponseCookieEntry>()
  return {
    set(name, value, options = {}) {
      pending.set(name, {name, value, options})
    },
    delete(name, options = {}) {
      pending.set(name, {name, value: null, options})
    },
    entries: () => [...pending.values()]
  }
}

let warned = false

/**
 * Browser-side stand-in. The hook exists on both sides so components never need a
 * `typeof window` guard, but only the SSR render produces headers — there is no response to
 * write to once the page is interactive. Use a normal `document.cookie` write (or a fetch to
 * a route) for client-side changes.
 */
export const createNoopResponseCookies = (): ResponseCookies => ({
  set: () => warnOnce(),
  delete: () => warnOnce(),
  entries: () => []
})

const warnOnce = (): void => {
  if (warned) return
  warned = true
  console.warn(
    '[pylon] useResponseCookies() was called in the browser, where there is no response to ' +
      'write to — the call did nothing. It only has an effect during SSR. For a client-side ' +
      'change, write `document.cookie` or call a route that sets it.'
  )
}
