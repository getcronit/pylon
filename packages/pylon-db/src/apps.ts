/**
 * Pylon "apps" — modular feature bundles (Django-style INSTALLED_APPS).
 *
 * An app owns a set of models and its own migrations directory; apps declare
 * dependencies on one another. This module is the MIGRATION-side orchestration:
 * it builds a `MigrationRunner` SCOPED to each app (its own dir + models + a
 * namespaced ledger) and drives generate/migrate/deploy/status across all apps
 * in dependency order.
 *
 * The scoping rests on two seams proven by the apps spike:
 *   - `current: () => toIR(appDefs)` — generate only this app's tables.
 *   - `resolveAgainst: () => toIR().entities` — but resolve cross-app FK targets
 *     against the GLOBAL registry, so an FK into another app still emits.
 *   - `ledgerPrefix: app.name` — isolate each app's rows in the shared ledger.
 *
 * `graphql`/`plugin` on an app are FRAMEWORK concerns (resolver composition,
 * runtime hooks); they're carried opaquely here so the host can compose them.
 */
import type {Database} from './database.js'
import {getDatabase} from './database.js'
import {toIR} from './ir.js'
import {MigrationRunner, type GeneratedMigration, type MigrationLoader} from './migration-runner.js'
import {getModelDefinitionOrThrow, type ModelDefinition} from './registry.js'

export interface AppDefinition {
  /** Unique app name — also the ledger namespace for its migrations. */
  name: string
  /** Model classes this app owns (scopes its migrations). */
  models?: Function[]
  /** Names of apps this app depends on — applied before it; FK targets resolve to them. */
  dependencies?: string[]
  /** This app's migrations directory (absolute, or resolved by the caller/CLI). */
  migrations?: string
  /** Opaque resolver fragment ({Query?, Mutation?, …}) — composed by the host. */
  graphql?: unknown
  /** Opaque runtime plugin — registered by the host. */
  plugin?: unknown
}

/** Identity helper for authoring an app manifest with inference. */
export function defineApp<const T extends AppDefinition>(app: T): T {
  return app
}

/**
 * Topologically order apps: every app comes after the apps it depends on.
 * Deterministic (siblings by name). Throws on a cycle or an unknown dependency.
 */
export function orderApps(apps: AppDefinition[]): AppDefinition[] {
  const byName = new Map(apps.map(a => [a.name, a]))
  const out: AppDefinition[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (a: AppDefinition): void => {
    if (visited.has(a.name)) return
    if (visiting.has(a.name)) throw new Error(`App dependency cycle at "${a.name}".`)
    visiting.add(a.name)
    for (const dep of a.dependencies ?? []) {
      const d = byName.get(dep)
      if (!d) throw new Error(`App "${a.name}" depends on unknown app "${dep}".`)
      visit(d)
    }
    visiting.delete(a.name)
    visited.add(a.name)
    out.push(a)
  }
  for (const a of [...apps].sort((x, y) => x.name.localeCompare(y.name))) visit(a)
  return out
}

/** Resolve an app's model classes to their registered definitions (the scoping set). */
export function appModelDefinitions(app: AppDefinition): ModelDefinition[] {
  return (app.models ?? []).map(getModelDefinitionOrThrow)
}

/**
 * A `MigrationRunner` scoped to one app: its own directory + models + ledger
 * namespace, resolving cross-app FK targets against the global registry universe.
 */
export function appRunner(app: AppDefinition, opts: {now?: () => string} = {}): MigrationRunner {
  if (!app.migrations) {
    throw new Error(`App "${app.name}" has no migrations directory configured.`)
  }
  const defs = appModelDefinitions(app)
  return new MigrationRunner({
    dir: app.migrations,
    current: () => {
      const ir = toIR(defs)
      return {version: ir.version, entities: ir.entities}
    },
    resolveAgainst: () => toIR().entities,
    ledgerPrefix: app.name,
    now: opts.now
  })
}

/** Generate a migration for ONE app (scoped to its own tables). */
export function generateApp(
  app: AppDefinition,
  name: string,
  load: MigrationLoader,
  opts: {renames?: GeneratedMigration['renameCandidates']; now?: () => string} = {}
): Promise<GeneratedMigration | null> {
  return appRunner(app, {now: opts.now}).generate(name, load, {renames: opts.renames})
}

export interface AppApplyResult {
  app: string
  applied: string[]
}

/** Apply every app's pending migrations, in dependency order. Idempotent. */
export async function migrateApps(
  apps: AppDefinition[],
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<AppApplyResult[]> {
  const out: AppApplyResult[] = []
  for (const app of orderApps(apps)) {
    out.push({app: app.name, applied: await appRunner(app).apply(load, db)})
  }
  return out
}

/**
 * Production apply across apps: first a GUARD pass (every app must have no
 * uncaptured model changes and no tampered history), then apply in dependency
 * order. Refusing before any write keeps a multi-app deploy all-or-nothing at
 * the gate.
 */
export async function deployApps(
  apps: AppDefinition[],
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<AppApplyResult[]> {
  const ordered = orderApps(apps)
  for (const app of ordered) {
    const runner = appRunner(app)
    const status = await runner.status(load, db)
    if (status.pendingChanges.length > 0) {
      throw new Error(
        `Refusing to deploy app "${app.name}": uncaptured model changes — ` +
          `run \`pylon db diff --app ${app.name}\` and commit the migration.`
      )
    }
    const tampered = await runner.integrityErrors(load, db)
    if (tampered.length > 0) {
      throw new Error(`Refusing to deploy app "${app.name}": tampered migration(s): ${tampered.join(', ')}`)
    }
  }
  const out: AppApplyResult[] = []
  for (const app of ordered) {
    out.push({app: app.name, applied: await appRunner(app).apply(load, db)})
  }
  return out
}

export interface AppStatus {
  app: string
  pendingChanges: number
  unapplied: string[]
}

/** Per-app status (uncaptured changes + unapplied migrations), in dependency order. */
export async function statusApps(
  apps: AppDefinition[],
  load: MigrationLoader,
  db?: Database
): Promise<AppStatus[]> {
  const out: AppStatus[] = []
  for (const app of orderApps(apps)) {
    const status = await appRunner(app).status(load, db)
    out.push({app: app.name, pendingChanges: status.pendingChanges.length, unapplied: status.unapplied})
  }
  return out
}
