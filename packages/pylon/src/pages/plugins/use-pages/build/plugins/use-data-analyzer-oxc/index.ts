/**
 * Bundler-agnostic core + rolldown/vite adapters for the oxc useData analyzer.
 *
 * Integration is virtual-module based (dev and build alike — nothing on disk):
 *   - `transform(page)` analyzes the page (whole-program, resolving its imports via
 *     oxc-resolver), rewrites each `useData()` call to reference a compiled `doc`,
 *     and registers a per-page SIDECAR module holding those docs;
 *   - `resolveId`/`load` serve that sidecar from an in-memory registry.
 *
 * The compiled documents live in the sidecar (bundled into the output like any
 * import); the page keeps only the import + the inline variables thunks.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import path from 'path'
import {buildSchema, type GraphQLSchema} from 'graphql'
import type {Plugin as RolldownPlugin} from 'rolldown'
import type {Plugin as VitePlugin} from 'rolldown-vite'
import {emitPage, sidecarSpecifier, sidecarVirtualId} from './emit'
import {ModuleGraph} from './module-graph'
import {clearParseCache} from './parse'
import {analyze} from './propagate'

export interface OxcAnalyzerOptions {
  filter?: RegExp
  pylonPackage?: string
  hookName?: string
  inContext?: boolean
  scalarTypes?: Record<string, string>
  schema?: GraphQLSchema
  schemaPath?: string
  tsconfig?: string
  /**
   * Reuse a page's analysis result across transforms when its source is byte-identical
   * (content-hash keyed). Safe for the production build, where the paired server and
   * client passes analyze the same frozen sources — the second pass then only re-wires
   * the compiled documents instead of re-analyzing. NOT for dev: there a page's
   * dependency can change while the page's own text does not, which must re-analyze.
   */
  reuseResults?: boolean
}

const VIRTUAL_PREFIX = '\0pylon-docs:'

const hashSource = (code: string): string =>
  crypto.createHash('sha1').update(code).digest('hex')

export function createOxcAnalyzerCore(options: OxcAnalyzerOptions = {}) {
  const {
    filter = /\.(ts|tsx)$/,
    pylonPackage = '@getcronit/pylon/pages',
    hookName = 'useData'
  } = options

  const loadSchema = (): GraphQLSchema | undefined => {
    if (options.schema) return options.schema
    const sdlPath = options.schemaPath ?? path.join(process.cwd(), '.pylon/schema.graphql')
    try {
      return buildSchema(fs.readFileSync(sdlPath, 'utf8'))
    } catch {
      return undefined
    }
  }

  let schema = loadSchema()
  /** virtualId -> sidecar module source. */
  const sidecars = new Map<string, string>()
  // One module graph for the whole build — resolver + parse/scope caches are reused
  // across pages instead of rebuilt per transform (the dominant multi-page cost).
  let graph = new ModuleGraph({tsconfig: options.tsconfig})
  /** file -> analysis warnings surfaced on its last transform (adapters emit them). */
  const warnings = new Map<string, string[]>()
  /** file -> last transform result, content-hash keyed (build-only result reuse). One
   *  entry per file (replaced on content change), so it stays bounded. */
  const resultCache = new Map<
    string,
    {hash: string; code: string | null; sidecar: string | null; warnings: string[]}
  >()
  let graphReady = false

  const start = () => {
    warnings.clear()
    schema = loadSchema() // re-read so dev picks up schema changes
    // The graph + parse cache are built once and reused across every build that
    // shares this core — notably the paired server and client production builds,
    // which analyze the same sources back-to-back. Rebuilding them per build re-read
    // and re-hashed the whole dependency graph a second time (the dominant cost).
    // Both caches are content-hash guarded, so a changed file still re-parses; dev
    // incremental edits invalidate explicitly via `invalidate()`.
    if (!graphReady) {
      clearParseCache()
      graph = new ModuleGraph({tsconfig: options.tsconfig})
      graphReady = true
    }
  }

  /** Analyze + rewrite one page. Returns null when there is nothing to do. */
  const transformPage = (id: string, code: string): string | null => {
    // Cheap pre-flight: skip files that can't contain a seed.
    if (!code.includes(pylonPackage)) return null
    if (
      !code.includes(hookName) &&
      !code.includes('usePaginatedData') &&
      !code.includes('useMutation') &&
      !code.includes('op.')
    ) {
      return null
    }
    if (!schema) return null // can't compile documents without a schema

    // Result reuse (build only): the analysis is deterministic over the page's source,
    // so the second (client) pass of a production build re-wires the already-computed
    // documents instead of re-analyzing. Content-hash keyed, so any source difference
    // recomputes — never stale within a build.
    const cacheKey = options.reuseResults ? hashSource(code) : null
    if (cacheKey) {
      const hit = resultCache.get(id)
      if (hit && hit.hash === cacheKey) {
        if (hit.sidecar != null) sidecars.set(sidecarVirtualId(id), hit.sidecar)
        if (hit.warnings.length) warnings.set(id, hit.warnings)
        else warnings.delete(id)
        return hit.code
      }
    }

    const {seeds, seedSelectors, nestedSelectors} = analyze([{path: id, text: code}], {
      schema,
      pylonPackage,
      tsconfig: options.tsconfig,
      graph
    })

    const emitted = emitPage(id, code, seeds, seedSelectors, nestedSelectors, {
      schema,
      inContext: options.inContext,
      scalarTypes: options.scalarTypes
    })
    if (!emitted) {
      if (cacheKey) resultCache.set(id, {hash: cacheKey, code: null, sidecar: null, warnings: []})
      return null
    }

    if (emitted.warnings.length) warnings.set(id, emitted.warnings)
    else warnings.delete(id)
    if (!emitted.changed) {
      if (cacheKey) resultCache.set(id, {hash: cacheKey, code: null, sidecar: null, warnings: emitted.warnings})
      return null
    }

    if (cacheKey) {
      resultCache.set(id, {
        hash: cacheKey,
        code: emitted.code,
        sidecar: emitted.sidecarCode,
        warnings: emitted.warnings
      })
    }
    sidecars.set(sidecarVirtualId(id), emitted.sidecarCode)
    return emitted.code
  }

  const warningsFor = (id: string): string[] => warnings.get(id) ?? []

  const resolveSidecar = (source: string): string | null =>
    source.startsWith('pylon-docs:') ? '\0' + source : null

  const loadSidecar = (id: string): string | null =>
    id.startsWith(VIRTUAL_PREFIX) ? sidecars.get(id) ?? null : null

  return {
    filter,
    start,
    transformPage,
    warningsFor,
    resolveSidecar,
    loadSidecar,
    sidecarSpecifier,
    get schema() {
      return schema
    }
  }
}

export type OxcAnalyzerCore = ReturnType<typeof createOxcAnalyzerCore>

/** rolldown adapter (production page build). Pass a shared `core` to reuse one warm
 *  module graph across the paired server + client builds (they analyze the same
 *  sources, so a second cold pass just re-reads the whole dependency graph). */
export function useDataOxcRolldown(
  options: OxcAnalyzerOptions = {},
  core: OxcAnalyzerCore = createOxcAnalyzerCore(options)
): RolldownPlugin {
  return {
    name: 'pylon-use-data-oxc',
    buildStart() {
      core.start()
    },
    resolveId(source) {
      return core.resolveSidecar(source)
    },
    load(id) {
      return core.loadSidecar(id)
    },
    transform: {
      filter: {id: core.filter},
      handler(code, id) {
        if (id.startsWith(VIRTUAL_PREFIX)) return null
        const out = core.transformPage(id, code)
        for (const w of core.warningsFor(id)) this.warn(w)
        return out == null ? null : {code: out, moduleType: id.endsWith('.tsx') ? 'tsx' : 'ts', map: null}
      }
    }
  }
}

/** vite adapter (dev engine). `enforce: 'pre'` so we see raw TS/TSX. */
export function useDataOxcVite(options: OxcAnalyzerOptions = {}): VitePlugin {
  const core = createOxcAnalyzerCore(options)
  let server: any

  return {
    name: 'pylon-use-data-oxc',
    enforce: 'pre',
    buildStart() {
      core.start()
    },
    configureServer(s: any) {
      server = s
    },
    resolveId(source) {
      return core.resolveSidecar(source)
    },
    load(id) {
      return core.loadSidecar(id)
    },
    transform(code, id) {
      if (id.startsWith('\0')) return null
      const filePath = id.split('?')[0]
      if (!core.filter.test(filePath)) return null

      // A page edit regenerates its sidecar in the registry, but the sidecar is a
      // separate (virtual) module vite has already cached. When its compiled docs
      // actually change, invalidate it so the dev server re-loads the new document.
      const virtualId = VIRTUAL_PREFIX + filePath
      const before = core.loadSidecar(virtualId)
      const out = core.transformPage(filePath, code)
      for (const w of core.warningsFor(filePath)) this.warn(w)
      const after = core.loadSidecar(virtualId)
      if (server && after != null && after !== before) {
        const mod = server.moduleGraph?.getModuleById?.(virtualId)
        if (mod) server.moduleGraph.invalidateModule(mod)
      }

      return out == null ? null : {code: out, map: null}
    }
  }
}
