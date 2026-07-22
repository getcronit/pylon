import ts from 'typescript'
import fs from 'node:fs'
import {
  buildSchema,
  isInterfaceType,
  isUnionType,
  type GraphQLInterfaceType,
  type GraphQLUnionType
} from 'graphql'
import {
  collapseInterfaceTwins,
  mergeIR,
  pruneUnreferencedEnums,
  toSDL,
  type PylonIR
} from '@getcronit/pylon-ir'
import {SchemaParser} from './schema-parser'
import path from 'path'

/**
 * Persistent TS state per entry so dev rebuilds REUSE the expensive work instead of
 * starting from scratch: a caching compiler host (keeps parsed SourceFiles — crucially
 * the huge lib.d.ts + node_modules type files that never change), the prior program
 * (structural reuse → the checker skips re-checking unchanged files), and the parsed
 * options object (oldProgram reuse requires stable options). The outer schema cache
 * (builder/index.ts) means this only runs when a source file actually changed; here we
 * make that re-introspection incremental. (A tsconfig edit isn't picked up until a dev
 * restart — config changes are rare and usually warrant one.)
 */
const tsState = new Map<
  string,
  {host: ts.CompilerHost; program: ts.Program; options: ts.CompilerOptions}
>()

function createCachingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  const cache = new Map<string, {mtime: number; file: ts.SourceFile | undefined}>()
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, langVersion, onError, shouldCreate) => {
    let mtime = -1
    try {
      mtime = fs.statSync(fileName).mtimeMs
    } catch {
      /* missing — let the real host report it */
    }
    const hit = cache.get(fileName)
    if (hit && hit.mtime === mtime) return hit.file
    const file = getSourceFile(fileName, langVersion, onError, shouldCreate)
    cache.set(fileName, {mtime, file})
    return file
  }
  return host
}

export interface BuildOptions {
  /**
   * An authoritative IR contribution (e.g. the ORM's entities) merged OVER what
   * the type-checker introspects. Where it overlaps by name it wins — so entity
   * types reflect the ORM's intent (precise scalars, hidden columns, relation
   * list-ness) instead of being re-derived from the resolver types. When given,
   * the returned `typeDefs` are rendered from the merged IR.
   */
  contributeIR?: PylonIR
}

type ResolverMap = Record<
  string,
  {__resolveType?: (obj: any) => string | null; [k: string]: unknown}
>

/**
 * Build a SELF-CONTAINED `__resolveType` for one interface/union. It must serialize to
 * `resolvers.js` via source extraction, so it can capture NOTHING from this scope — the
 * member list is inlined as a literal and the analyzer's structural resolver is inlined
 * as source. Order: trust `__typename` if it names a CURRENT concrete member (the
 * post-merge list — a stale one is exactly why an STI subclass like `FileAsset` used to
 * be rejected), else fall back to the analyzer's structural checks (for plain, non-ORM
 * returns with no `__typename`). `new Function` guarantees the result has no closure.
 */
function buildResolveType(
  validNames: string[],
  prior: ((n: any) => string | null) | undefined
): (n: any) => string | null {
  const names = JSON.stringify(validNames)
  const fallback =
    typeof prior === 'function' ? `return (${prior.toString()})(node);` : 'return null;'
  return new Function(
    'node',
    `if (!node || typeof node !== 'object') return null;
     if (node.__typename && ${names}.indexOf(node.__typename) !== -1) return node.__typename;
     ${fallback}`
  ) as (n: any) => string | null
}

/**
 * Rebuild `__resolveType` for every interface/union the EMITTED SDL declares. Keying off
 * the SDL is what makes this robust: analyzer twins that got collapsed or pruned
 * (`IModel`, `IAsset`, …) leave no orphan resolver behind — the old IR-driven
 * reconciliation is exactly what produced "X defined in resolvers, but not in schema".
 * Each resolver is self-contained (no closures — the previous approach captured `prior`
 * and serialized to a dangling free variable), `__typename`-first against the CURRENT
 * members, with the analyzer's structural resolver kept as the no-`__typename` fallback.
 */
function attachUniversalResolveType(
  resolvers: ResolverMap,
  typeDefs: string
): ResolverMap {
  // Parse the emitted SDL into a real schema and ask graphql-js for the abstract types
  // and their concrete implementers — the canonical, post-merge source of truth (handles
  // interface-implements-interface + unions; no string scraping). `assumeValidSDL` keeps
  // it lenient (the SDL is already the build output).
  const schema = buildSchema(typeDefs, {assumeValidSDL: true})
  const abstractTypes = Object.values(schema.getTypeMap()).filter(
    (t): t is GraphQLInterfaceType | GraphQLUnionType =>
      !t.name.startsWith('__') && (isInterfaceType(t) || isUnionType(t))
  )
  const polymorphic = new Set(abstractTypes.map(t => t.name))

  const out: ResolverMap = {}
  // Drop entries that exist ONLY to carry a `__resolveType` for a type the schema no
  // longer declares (collapsed/pruned analyzer twins) — else the schema rejects them.
  for (const [name, r] of Object.entries(resolvers)) {
    const polyOnly =
      r && typeof r === 'object' && '__resolveType' in r && Object.keys(r).length === 1
    if (polyOnly && !polymorphic.has(name)) continue
    out[name] = r
  }
  for (const t of abstractTypes) {
    const validNames = schema.getPossibleTypes(t).map(pt => pt.name)
    out[t.name] = {
      ...(out[t.name] ?? {}),
      __resolveType: buildResolveType(validNames, out[t.name]?.__resolveType)
    }
  }
  return out
}

/**
 * Attach the runtime resolvers for the opt-in `Node` global-id layer, when the
 * merged IR declares the `Node` interface (i.e. an app set `node: true`). Only the
 * entities that opted in carry `implements Node`, so the `id`→gid encoder below is
 * attached exactly to those — per-model, matching the IR:
 *
 *  - `Query.node(id)` → `resolveNode(id)` from pylon-db. Reached via a dynamic
 *    `import()` because `resolvers.js` inlines each function's SOURCE with no
 *    imports in scope — a `new Function` body is the only closure-free way to
 *    call into the ORM at runtime.
 *  - each `Node` type's `id` → a `gid://pylon/<Type>/<id>` string. The encoder is
 *    pure concatenation, so it's inlined (synchronous, import-free). The literal
 *    prefix MUST match `GID_NAMESPACE` in pylon-db's `gid.ts`.
 *
 * Injected into the build resolver map (merged one level deep over the app's own
 * resolvers at runtime), so user `Query` fields and any hand-written entity field
 * resolvers are preserved.
 */
function attachNodeResolvers(resolvers: ResolverMap, ir: PylonIR): void {
  if (!ir.interfaces?.Node) return

  resolvers.Query = {
    ...(resolvers.Query as Record<string, unknown>),
    node: new Function(
      '_parent',
      'args',
      "return import('@getcronit/pylon-db').then(function (m) { return m.resolveNode(args.id) })"
    ) as never
  }

  for (const entity of Object.values(ir.entities)) {
    if (!entity.implements.includes('Node')) continue
    // The type segment is known at build; the `gid://<ns>/` prefix is read at
    // runtime from the process global that the `node` option's namespace sets
    // (default `gid://pylon/`), so encode and decode share one configurable
    // namespace without baking it into the serialized source.
    resolvers[entity.name] = {
      ...(resolvers[entity.name] as Record<string, unknown>),
      id: new Function(
        'src',
        `return src == null || src.id == null ? null : ` +
          `((globalThis.__PYLON_GID_PREFIX__ || 'gid://pylon/') + ${JSON.stringify(entity.name)} + '/' + src.id)`
      ) as never
    }
  }
}

/**
 * Hide ORM entity members declared `private` (or `#`-private) from the generated API.
 *
 * The ORM contributes its field list via RUNTIME introspection (`introspectViaRunner`),
 * which can't observe a TS-only `private` modifier — it's erased at compile time, so at
 * runtime a `private` column is an ordinary property and the only surviving hint is the
 * `$` sigil. That leaves an inconsistency: the analyzer path already drops `private`/`#`
 * members (see `getProperties`), but ORM columns/relations would leak into the SDL. We
 * reconcile them here, where the TS `Program` (the AST) IS available: for each entity we
 * read its class declaration and flip `exposed = false` on every field whose backing
 * member is `private`/`#`. Matching is by name with the leading `#`/`$` stripped, mirroring
 * the ORM's own exposed-name derivation. Physical columns are untouched (visibility lives
 * in `exposed`), so this is purely an API-projection change — identical to the `$` sigil.
 */
function hidePrivateOrmMembers(ir: PylonIR, program: ts.Program): void {
  // entity name → set of private member names (leading `#`/`$` stripped)
  const hiddenByEntity = new Map<string, Set<string>>()
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    sf.forEachChild(node => {
      if (!ts.isClassDeclaration(node) || !node.name) return
      const entityName = node.name.text
      if (!ir.entities[entityName]) return // only ORM entities matter
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) && !ts.isMethodDeclaration(member)) continue
        const name = member.name
        if (!ts.isIdentifier(name) && !ts.isPrivateIdentifier(name)) continue
        const isPrivate =
          ts.isPrivateIdentifier(name) ||
          !!(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private)
        if (!isPrivate) continue
        const key = name.text.replace(/^#/, '').replace(/^\$/, '')
        let set = hiddenByEntity.get(entityName)
        if (!set) hiddenByEntity.set(entityName, (set = new Set()))
        set.add(key)
      }
    })
  }
  for (const [entityName, hidden] of hiddenByEntity) {
    for (const field of ir.entities[entityName].fields) {
      if (hidden.has(field.name)) field.exposed = false
    }
  }
}

export class SchemaBuilder {
  private program: ts.Program
  private checker: ts.TypeChecker
  private sfiFile!: ts.SourceFile
  private sfi!: ts.Symbol
  private sfiFilePath: string

  constructor(sfiFilePath: string) {
    this.sfiFilePath = sfiFilePath

    const filesInSfiDir = ts.sys
      .readDirectory(path.dirname(this.sfiFilePath), ['.ts'], ['.d.ts'])
      .concat([path.join(path.dirname(this.sfiFilePath), '..', 'pylon.d.ts')])

    // Reuse the prior build's host/options/program for this entry (see tsState):
    // unchanged files (esp. lib + deps) skip re-parsing, and the checker reuses
    // their type info — making a re-introspection after a source edit incremental.
    const prev = tsState.get(this.sfiFilePath)
    const tsConfigOptions = prev?.options ?? this.loadTsConfigOptions()
    const host = prev?.host ?? createCachingHost(tsConfigOptions)

    this.program = ts.createProgram(
      filesInSfiDir,
      tsConfigOptions,
      host,
      prev?.program
    )
    this.checker = this.program.getTypeChecker()

    tsState.set(this.sfiFilePath, {host, program: this.program, options: tsConfigOptions})

    this.loadSfi()
  }

  private loadSfi() {
    const sourceFiles = this.program.getSourceFiles()

    const file = sourceFiles.find(
      file => path.resolve(file.fileName) === this.sfiFilePath
    )

    if (!file) {
      throw new Error('Could not find index.ts (pylon entrypoint)')
    }

    this.sfiFile = file

    const sfiFileSymbol = this.checker.getSymbolAtLocation(file)!
    const sfiFileExports = this.checker.getExportsOfModule(sfiFileSymbol!)

    // The entry MUST default-export the Pylon app (`export default new Pylon()...`).
    // `build()` reads its `.graphql` property type. This is the single source of
    // truth — the app carries both the typed surface (build) and the resolvers
    // (run). (Breaking: the legacy named `export const graphql` is gone.)
    const def = sfiFileExports.find(s => s.escapedName === 'default')
    if (!def) {
      throw new Error(
        'Pylon entry must `export default` the app (e.g. `export default new Pylon(...)`).'
      )
    }

    this.sfi = def
  }

  private loadTsConfigOptions() {
    const defaultOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: false,
      forceConsistentCasingInFileNames: true,
      noImplicitAny: true,
      experimentalDecorators: true
    }

    // Find the tsconfig.json file
    const configPath = ts.findConfigFile(
      path.dirname(this.sfiFilePath), // Directory to start searching from
      ts.sys.fileExists, // Function to check if a file exists
      'tsconfig.json' // File name to search for
    )

    if (!configPath) {
      console.log('Could not find tsconfig.json')
      return defaultOptions
    }

    // Read the tsconfig.json file
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

    if (configFile.error) {
      console.log('Could not read tsconfig.json', configFile.error)
      return defaultOptions
    }

    // Parse the tsconfig.json file
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    )

    // FORCE strictNullChecks for introspection regardless of the user's tsconfig.
    // Nullability is schema-significant: a resolver returning `T | null` MUST emit a
    // nullable field. Without strictNullChecks, TypeScript collapses `T | null` into
    // `T`, so a non-strict project would silently get NON-null fields (and `pull`
    // would propagate the wrong nullability downstream). The build only READS types
    // for schema derivation — it never reports typecheck errors to the user — so
    // forcing this is safe and only makes the derived schema accurate.
    return {...parsedConfig.options, strictNullChecks: true}
  }

  public build(options: BuildOptions = {}) {
    let sfiType = this.checker.getTypeOfSymbolAtLocation(this.sfi, this.sfiFile)

    // If `this.sfi` is a default-exported Pylon app (not a bare resolver object),
    // it has no Query/Mutation/Subscription of its own — dig into its `.graphql`
    // property, which carries the (instantiated) merged resolver type.
    const hasRootOp =
      sfiType.getProperty('Query') ||
      sfiType.getProperty('Mutation') ||
      sfiType.getProperty('Subscription')
    if (!hasRootOp) {
      // INSTANTIATED property type (substitutes the class generic `G`) — NOT
      // `getTypeOfSymbolAtLocation`, which resolves the property's *declared* type
      // (the bare `G`, i.e. its constraint with no concrete fields).
      const gType = (this.checker as any).getTypeOfPropertyOfType?.(
        sfiType,
        'graphql'
      )
      if (gType) sfiType = gType
    }

    // const plainResolversProperty = sfiType.getProperty('plainResolvers')

    // if (!plainResolversProperty) {
    //   throw new Error('Could not find plainResolvers property')
    // }

    // const plainResolversType = this.checker.getTypeOfSymbolAtLocation(
    //   plainResolversProperty,
    //   this.sfiFile
    // )

    const queryProperty = sfiType.getProperty('Query')
    const mutationProperty = sfiType.getProperty('Mutation')
    const subscriptionProperty = sfiType.getProperty('Subscription')

    const queryType = queryProperty
      ? this.checker.getTypeOfSymbolAtLocation(queryProperty, this.sfiFile)
      : undefined
    const mutationType = mutationProperty
      ? this.checker.getTypeOfSymbolAtLocation(mutationProperty, this.sfiFile)
      : undefined
    const subscriptionType = subscriptionProperty
      ? this.checker.getTypeOfSymbolAtLocation(
          subscriptionProperty,
          this.sfiFile
        )
      : undefined

    const parser = new SchemaParser(this.checker, this.sfiFile, this.program)

    parser.parse({
      Query: queryType,
      Mutation: mutationType,
      Subscription: subscriptionType
    })

    // The IR is ALWAYS produced (it's the projection boundary). With an authoritative
    // ORM contribution it's merged (entity types win on overlap) and the SDL is
    // rendered from it; without one the default SDL path stays byte-for-byte unchanged
    // (`parser.toString()`), but `ir` is still returned so `pylon inspect` can serialize
    // the model whether or not the project uses the ORM.
    const base = parser.toIR()
    let ir = base
    if (options.contributeIR) {
      // STI: collapse the analyzer's conservative `I<Base>` twin into the ORM's
      // single-table-inheritance interface `<Base>` before rendering.
      ir = collapseInterfaceTwins(mergeIR(base, options.contributeIR))
      // Drop `private`/`#` ORM members from the API (the runtime IR can't see the
      // TS-only modifier). Runs BEFORE pruning so a now-orphaned enum is removed too.
      hidePrivateOrmMembers(ir, this.program)
      ir = pruneUnreferencedEnums(ir)
    }

    const typeDefs = options.contributeIR ? toSDL(ir) : parser.toString()
    // Attach the universal `__typename`-first `__resolveType` to every interface/union
    // the SDL declares (ORM path). Driven by the SDL so no orphan resolvers survive.
    const resolvers = options.contributeIR
      ? attachUniversalResolveType(parser.getResolvers(), typeDefs)
      : parser.getResolvers()
    // Global-id (`Node`) resolvers: `node(id)` refetch + per-type `id`→gid encoding.
    if (options.contributeIR) attachNodeResolvers(resolvers, ir)

    return {
      typeDefs,
      schema: parser.getSchema(),
      resolvers,
      ir
    }
  }

  /**
   * The real source files the type program depends on (excluding lib + deps) —
   * the entry plus everything it transitively imports. The dev build hashes these
   * to cache the (expensive ~1s+) schema derivation and skip it when none changed.
   */
  public getSourceFiles(): string[] {
    return this.program
      .getSourceFiles()
      .map(f => f.fileName)
      .filter(n => !n.includes('/node_modules/') && !n.endsWith('.d.ts'))
  }
}
