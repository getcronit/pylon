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
import * as fs from 'fs'
import path from 'path'
import {buildSchema, type GraphQLSchema} from 'graphql'
import type {Plugin as RolldownPlugin} from 'rolldown'
import type {Plugin as VitePlugin} from 'rolldown-vite'
import {emitPage, sidecarSpecifier, sidecarVirtualId} from './emit'
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
}

const VIRTUAL_PREFIX = '\0pylon-docs:'

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

  const start = () => {
    clearParseCache()
    schema = loadSchema() // re-read so dev picks up schema changes
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

    const {seeds, seedSelectors, nestedSelectors} = analyze([{path: id, text: code}], {
      schema,
      pylonPackage,
      tsconfig: options.tsconfig
    })

    const emitted = emitPage(id, code, seeds, seedSelectors, nestedSelectors, {
      schema,
      inContext: options.inContext,
      scalarTypes: options.scalarTypes
    })
    if (!emitted) return null

    sidecars.set(sidecarVirtualId(id), emitted.sidecarCode)
    return emitted.code
  }

  const resolveSidecar = (source: string): string | null =>
    source.startsWith('pylon-docs:') ? '\0' + source : null

  const loadSidecar = (id: string): string | null =>
    id.startsWith(VIRTUAL_PREFIX) ? sidecars.get(id) ?? null : null

  return {
    filter,
    start,
    transformPage,
    resolveSidecar,
    loadSidecar,
    sidecarSpecifier,
    get schema() {
      return schema
    }
  }
}

/** rolldown adapter (production page build). */
export function useDataOxcRolldown(options: OxcAnalyzerOptions = {}): RolldownPlugin {
  const core = createOxcAnalyzerCore(options)
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
      const after = core.loadSidecar(virtualId)
      if (server && after != null && after !== before) {
        const mod = server.moduleGraph?.getModuleById?.(virtualId)
        if (mod) server.moduleGraph.invalidateModule(mod)
      }

      return out == null ? null : {code: out, map: null}
    }
  }
}
