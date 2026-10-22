/**
 * DEV-ONLY message normalization for the two Vite instances `pylon dev` drives.
 *
 * Pylon uses Vite as a LIBRARY (`configFile: false` on both the pages client server and
 * the server-plane module runner). A Pylon app therefore has NO `vite.config.ts` — but
 * Vite's own diagnostics assume it does, so its advice ("add this to `server.allowedHosts`
 * in vite.config.js", "try adding it to `optimizeDeps.exclude`") points app authors at a
 * file that doesn't exist and a knob they don't own.
 *
 * So every message we let through gets rewritten: the technical cause (ids, paths, stacks)
 * is preserved verbatim — that's what makes an error debuggable — and only the *actionable
 * advice* is restated in terms of things a Pylon app actually has. Advice that has no Pylon
 * equivalent is dropped rather than translated into a knob we don't ship.
 *
 * Set `PYLON_DEBUG_VITE=1` to bypass all of this and see Vite's raw output — that's the
 * mode for working ON the framework, where the internal vocabulary is the point.
 */

/** Vite's own config-file names, as they appear inside its messages. */
const VITE_CONFIG_FILE = /vite\.config\.[cm]?[jt]s/

/** Once-per-message footnote explaining why the (now stripped) advice is gone. */
const NO_CONFIG_NOTE =
  'Pylon configures the dev bundler internally — a Pylon app has no vite config.'

/**
 * Messages that are pure noise for an app author: they describe Vite-internal
 * bookkeeping that Pylon owns, and nothing in them is actionable outside the framework.
 */
const SILENCED: RegExp[] = [
  // @vitejs/plugin-react@5 sets `optimizeDeps.esbuildOptions.jsx`, which rolldown-vite
  // deprecates in favour of `optimizeDeps.rolldownOptions`. Not actionable until the
  // plugin and Vite majors line up — and it's our dep choice, not the app's.
  /optimizeDeps\.esbuildOptions/,
  // Cold-start tuning advice for a config the app doesn't have.
  /add these dependencies to optimizeDeps\.include/,
  // Self-healing: the client reloads and picks up the new pre-bundle.
  /There is a new version of the pre-bundle for/
]

/**
 * Ordered rewrites. Each rule replaces Vite-vocabulary advice with the Pylon-true
 * statement of the same fact; the surrounding technical detail is left untouched.
 */
/**
 * Vite emits the same sentence twice over: plain text to the terminal, and HTML-escaped
 * with `<br/>` line breaks in its 403/500 response pages. These fragments let one rule
 * match both spellings.
 */
const Q = '(?:"|&quot;|&#34;)'
/** Whitespace OR an HTML line break — whichever spelling of "newline" the surface uses. */
const SEP = '(?:\\s|<br\\s*/?>)*'

const RULES: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  // `server.fs.allow` denial — the app can't widen the list, so state the boundary instead.
  [
    new RegExp(
      `The request (?:id|url) ${Q}(.*?)${Q} is outside of Vite serving allow list\\.?`,
      'g'
    ),
    (_m, id) =>
      `"${id}" is outside the files \`pylon dev\` serves (your project and its workspace).`
  ],
  // Host check — Vite's phrasing names its config; ours names the CLI.
  [
    new RegExp(
      `Blocked request\\. This host \\((.*?)\\) is not allowed\\.(?:${SEP}To allow this host, add(?:(?!<br)[^\\n])*)?`,
      'g'
    ),
    (_m, host) =>
      `Blocked request: the host ${host} is not allowed by \`pylon dev\`.`
  ],
  // Dep pre-bundling — `optimizeDeps.exclude` is ours, so give the app author the step
  // that IS theirs (clear the cache) and the real diagnosis (not browser-compatible).
  [
    /The dependency might be incompatible with the dep optimizer\. Try adding it to `optimizeDeps\.exclude`\.?/g,
    'It could not be pre-bundled for the browser — remove `node_modules/.vite-pylon-pages` and restart `pylon dev`; if it persists, the dependency is likely not browser-compatible.'
  ],
  // Vite config-option doc links are documentation for a file the app doesn't have.
  [
    new RegExp(
      `${SEP}Refer to docs https://vite\\.dev/config/[^\\s<]*(?: for configurations and more details\\.)?`,
      'g'
    ),
    ''
  ],
  [
    new RegExp(`${SEP}Check out https://vite\\.dev/config/[^\\s<]*`, 'g'),
    ''
  ],
  // Anything still pointing at the config file: drop the pointer, keep the sentence.
  [new RegExp(`\\s*(?:in|to|see)\\s+\`?${VITE_CONFIG_FILE.source}\`?`, 'g'), ''],
  // Tool identity in log/error prefixes — the app author is running Pylon, not Vite.
  [/\[plugin:vite:([\w-]+)\]/g, '[pylon:$1]'],
  [/\[vite:([\w-]+)\]/g, '[pylon:$1]'],
  [/\[vite\]/g, '[pylon]']
]

const debugVite = (): boolean => process.env.PYLON_DEBUG_VITE === '1'

/** True when this message should never reach the app author's terminal. */
export function isSilencedViteMessage(text: string): boolean {
  if (debugVite()) return false
  return SILENCED.some(re => re.test(text))
}

/** Restate a Vite message in Pylon's vocabulary. Cause and paths survive untouched. */
export function rewriteViteText(text: string): string {
  if (debugVite() || !text) return text
  const mentionedConfig = VITE_CONFIG_FILE.test(text)
  let out = text
  for (const [re, replacement] of RULES) {
    out = out.replace(re, replacement as any)
  }
  // Only footnote when we actually stripped a pointer at the missing file — otherwise
  // every unrelated warning would carry a paragraph about config files.
  if (mentionedConfig) out = `${out.trimEnd()}\n${NO_CONFIG_NOTE}`
  return out
}

/**
 * Rewrite an error in place (message/stack/plugin) so the same normalization applies
 * whether the error is logged, thrown to the terminal, or shipped to the browser overlay.
 * Returns the same error so it can be used inline in a `catch`.
 */
export function sanitizeViteError<T>(err: T): T {
  if (debugVite() || !err || typeof err !== 'object') return err
  const e = err as Record<string, unknown>
  try {
    if (typeof e.message === 'string') e.message = rewriteViteText(e.message)
    if (typeof e.stack === 'string') e.stack = rewriteViteText(e.stack)
    if (typeof e.plugin === 'string') e.plugin = rewriteViteText(`[${e.plugin}]`).slice(1, -1)
    if (typeof e.frame === 'string') e.frame = rewriteViteText(e.frame)
  } catch {
    /* a frozen/exotic error object keeps its original text — never fail on cosmetics */
  }
  return err
}

/** The shape of Vite's `createLogger()` result we depend on. */
export interface ViteLoggerLike {
  info(msg: string, options?: unknown): void
  warn(msg: string, options?: unknown): void
  warnOnce(msg: string, options?: unknown): void
  error(msg: string, options?: unknown): void
  clearScreen?(type?: unknown): void
  hasErrorLogged?(error: unknown): boolean
  hasWarned?: boolean
}

/**
 * Wrap a Vite logger so everything it prints goes through {@link rewriteViteText} and the
 * silenced set is dropped.
 *
 * Delegates through the prototype rather than spreading: `hasWarned` is a live property
 * Vite reads back off the logger, and a spread would freeze a stale copy of it.
 */
export function wrapViteLogger(base: ViteLoggerLike): ViteLoggerLike {
  const wrapped: ViteLoggerLike = Object.create(base)
  const relay =
    (level: 'info' | 'warn' | 'warnOnce' | 'error') =>
    (msg: string, options?: unknown) => {
      if (typeof msg === 'string') {
        if (isSilencedViteMessage(msg)) return
        base[level](rewriteViteText(msg), sanitizeLogOptions(options))
        return
      }
      base[level](msg, options)
    }
  wrapped.info = relay('info')
  wrapped.warn = relay('warn')
  wrapped.warnOnce = relay('warnOnce')
  wrapped.error = relay('error')
  return wrapped
}

/** Vite passes the originating error alongside the text — normalize that too. */
function sanitizeLogOptions(options: unknown): unknown {
  if (options && typeof options === 'object' && 'error' in options) {
    sanitizeViteError((options as {error: unknown}).error)
  }
  return options
}

/**
 * Rewrite Vite's own ERROR RESPONSE BODIES (the 403 "Restricted" page for a path outside
 * the served roots, the 403 host-check page, the 500 transform page). These are written
 * straight to the socket by Vite's middlewares — they never pass through the logger or the
 * HMR channel — so this is the only place to catch them.
 *
 * Scoped to error statuses with a textual content type: module payloads and asset bytes
 * are never touched, so nothing rewrites code the browser is about to execute.
 */
export function sanitizeViteHttpErrors(res: {
  statusCode: number
  headersSent: boolean
  getHeader(name: string): unknown
  setHeader(name: string, value: any): unknown
  write: (...args: any[]) => boolean
  end: (...args: any[]) => any
}): void {
  if (debugVite()) return
  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)

  const isTextualError = (): boolean => {
    if (res.statusCode < 400) return false
    const type = res.getHeader('content-type')
    // Vite's 403 page sets no content-type at all (it just writes HTML), so an absent
    // type on an error response counts as text — a declared one must actually be textual.
    if (type == null) return true
    const value = String(type)
    return value.startsWith('text/') || value.includes('json')
  }

  const rewriteChunk = (chunk: unknown): unknown => {
    if (!isTextualError()) return chunk
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : null
    if (text === null) return chunk
    const out = rewriteViteText(text)
    if (out === text) return chunk
    if (!res.headersSent && res.getHeader('content-length') != null) {
      res.setHeader('content-length', Buffer.byteLength(out))
    }
    return typeof chunk === 'string' ? out : Buffer.from(out, 'utf8')
  }

  res.write = (chunk: any, ...rest: any[]) => originalWrite(rewriteChunk(chunk), ...rest)
  res.end = (chunk: any, ...rest: any[]) =>
    typeof chunk === 'function'
      ? originalEnd(chunk, ...rest)
      : originalEnd(rewriteChunk(chunk), ...rest)
}

/**
 * Patch a dev server's HMR channel so the browser ERROR OVERLAY — the surface an app
 * author actually reads during a broken edit — carries the rewritten text too.
 */
export function patchViteOverlayMessages(server: {
  hot?: {send?: (...args: any[]) => void}
  environments?: {client?: {hot?: {send?: (...args: any[]) => void}}}
}): void {
  if (debugVite()) return
  const channels = [server.hot, server.environments?.client?.hot]
  for (const channel of channels) {
    const send = channel?.send
    if (!channel || typeof send !== 'function' || (channel as any).__pylonPatched) continue
    ;(channel as any).__pylonPatched = true
    channel.send = (...args: any[]) => {
      const payload = args[0]
      if (payload && typeof payload === 'object' && payload.type === 'error') {
        sanitizeViteError(payload.err)
      }
      return send.apply(channel, args)
    }
  }
}
