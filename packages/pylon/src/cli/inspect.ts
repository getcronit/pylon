/**
 * `pylon inspect` — serialize the whole app as one deterministic model.
 *
 * The `AppModel` wraps the pure `PylonIR` (GraphQL schema + persistence — kept
 * runtime-agnostic in `@getcronit/pylon/ir`) with the cross-layer slices that only
 * exist at the framework level: queues and authz-shape. It's the single artifact
 * every downstream tool (diff, verify, the MCP's `describe_app`) consumes.
 *
 * Harvest is cheap because the model is already complete: loading the project for
 * the ORM IR runs EVERY `@model()`/`@queue()` decorator (discovery guarantees it),
 * so the registries are populated by the time we read them.
 */
import path from 'node:path'
import {toDDL, tableSpecOf, toSDL, type PylonIR} from '../ir'
import {introspectAppData} from './project-bridge.js'
import {SchemaBuilder} from './builder/schema/builder.js'

/** Per-model authorization + persistence shape (Tier 2). Rule bodies stay runtime. */
export interface AuthzInfo {
  model: string
  table: string
  app?: string
  /** Column auto-scoped by tenant, if the model is tenant-scoped. */
  tenant?: string
  /** Deny-by-default: an action with no matching rule is rejected. */
  secure: boolean
}

/** Declared queue shape (Tier 2). The processor body stays runtime. */
export interface QueueInfo {
  name: string
  attempts?: number
  concurrency?: number
  /** Whether the payload is validated by a schema at runtime. */
  hasSchema: boolean
}

/** The whole app as one serializable, versioned model. */
export interface AppModel {
  version: 1
  /** The pure GraphQL + persistence IR (operations, types, entities, relations). */
  schema: PylonIR
  /** Per-model authz + tenant shape. */
  authz: AuthzInfo[]
  /** Declared background queues. */
  queues: QueueInfo[]
}

/** Build the `AppModel` for the project at `cwd`. */
export async function inspectApp(
  cwd: string,
  modelsEntry = './src/index.ts'
): Promise<AppModel> {
  // Load the project in a child process (its real modules, project context), which
  // constructs the app and returns the serializable ORM-derived data: the entity IR,
  // per-model authz/tenant shape (the ORM registry), and declared queues (the
  // project's pylon-queues, if any). See PROJECT_LOADER_DESIGN.md.
  const {ir: ormIR, authz: rawAuthz, queues: rawQueues} = await introspectAppData(cwd, modelsEntry)

  const contributeIR =
    ormIR && Object.keys(ormIR.entities).length > 0 ? ormIR : undefined

  const entryAbs = path.resolve(cwd, modelsEntry)
  const {ir} = new SchemaBuilder(entryAbs).build({contributeIR})

  const authz: AuthzInfo[] = rawAuthz.sort((a, b) => a.model.localeCompare(b.model))
  const queues: QueueInfo[] = rawQueues.sort((a, b) => a.name.localeCompare(b.name))

  return {version: 1, schema: canonicalize(pruneEmptyTypes(ir)), authz, queues}
}

/** Sort a record's keys for a stable, diffable serialization. */
function sortKeys<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(rec).sort()) out[k] = rec[k]
  return out
}

/**
 * Drop empty object/interface types and strip them from `implements`. The ORM base
 * `Model`/`IModel` surface as empty types in the raw IR; they're noise (and an empty
 * GraphQL interface is invalid), so they don't belong in the serialized model.
 */
function pruneEmptyTypes(ir: PylonIR): PylonIR {
  const empty = new Set<string>()
  for (const [k, v] of Object.entries(ir.objects)) if (!v.fields?.length) empty.add(k)
  for (const [k, v] of Object.entries(ir.interfaces)) if (!v.fields?.length) empty.add(k)
  if (empty.size === 0) return ir

  const clean = <V extends {implements?: string[]}>(v: V): V =>
    v.implements?.some(i => empty.has(i))
      ? {...v, implements: v.implements.filter(i => !empty.has(i))}
      : v
  const map = <V extends {implements?: string[]}>(
    rec: Record<string, V>,
    keep: (k: string) => boolean
  ): Record<string, V> => {
    const out: Record<string, V> = {}
    for (const [k, v] of Object.entries(rec)) if (keep(k)) out[k] = clean(v)
    return out
  }

  return {
    ...ir,
    entities: map(ir.entities, () => true),
    objects: map(ir.objects, k => !empty.has(k)),
    interfaces: map(ir.interfaces, k => !empty.has(k))
  }
}

/** Canonical ordering so `pylon inspect` is byte-stable (a prerequisite for diffApp). */
function canonicalize(ir: PylonIR): PylonIR {
  return {
    ...ir,
    entities: sortKeys(ir.entities),
    objects: sortKeys(ir.objects),
    interfaces: sortKeys(ir.interfaces),
    unions: sortKeys(ir.unions),
    inputs: sortKeys(ir.inputs),
    enums: sortKeys(ir.enums),
    scalars: [...ir.scalars].sort(),
    operations: [...ir.operations].sort((a, b) =>
      `${a.root}.${a.name}`.localeCompare(`${b.root}.${b.name}`)
    )
  }
}

/** Render the AppModel's persistence layer as Postgres DDL. */
export function appModelToDDL(model: AppModel): string {
  return Object.values(model.schema.entities)
    .map(entity => toDDL(tableSpecOf(entity)))
    .join('\n\n')
}

/** Render the AppModel's GraphQL schema as SDL. */
export function appModelToSDL(model: AppModel): string {
  return toSDL(model.schema)
}
