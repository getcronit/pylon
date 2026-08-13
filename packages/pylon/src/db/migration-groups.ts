/**
 * Migration GROUPS — the data-layer primitive behind framework "apps".
 *
 * A group is a named, dependency-ordered set of models with its own migrations
 * directory. This module is deliberately app-AGNOSTIC: it knows nothing about
 * GraphQL, Hono, or plugins (those live in `@getcronit/pylon`). The framework
 * projects each app to a `MigrationGroup` and hands the projection here.
 *
 * Per-group scoping rests on two seams:
 *   - `current: () => toIR(groupModels)` — generate only this group's tables.
 *   - `resolveAgainst: () => toIR().entities` — resolve cross-group FK targets
 *     against the GLOBAL registry, so an FK into another group still emits.
 *   - `ledgerPrefix: group.name` — isolate each group's rows in the shared ledger.
 */
import {joinTableName} from '@getcronit/pylon-ir'
import type {Database} from './database.js'
import {getDatabase} from './database.js'
import {toIR} from './ir.js'
import {MigrationRunner, type GeneratedMigration, type MigrationLoader} from './migration-runner.js'
import {
  allModels,
  getAppMeta,
  getModelDefinition,
  getModelDefinitionOrThrow,
  type ModelDefinition
} from './registry.js'

export interface MigrationGroup {
  /** Unique group name — also the ledger namespace for its migrations. */
  name: string
  /** Model classes this group owns (scopes its migrations). */
  models?: Function[]
  /** Names of groups this one depends on — applied before it; FK targets resolve to them. */
  dependencies?: string[]
  /** This group's migrations directory (absolute, or resolved by the caller). */
  dir?: string
}

/**
 * DERIVE migration groups from the registry: every model tagged via
 * `models.app(name)` joins group `name`. Dependencies are INFERRED from cross-app
 * `belongsTo` FKs (a model whose FK targets another app's model ⇒ this group
 * depends on that one), unioned with any explicit `dependsOn` from
 * `models.app(name, {dependsOn})`. `dir` carries the app's declared `migrations`
 * directory (colocated with the app source); the CLI resolves it to an absolute path.
 */
export function appGroups(): MigrationGroup[] {
  const byApp = new Map<string, ModelDefinition[]>()
  for (const def of allModels()) {
    if (!def.app) continue // untagged models aren't part of an app group
    const list = byApp.get(def.app) ?? []
    list.push(def)
    byApp.set(def.app, list)
  }

  // Which app(s) OWN (synthesize) each join table — for the cross-app conflict
  // guard. The inverse side doesn't synthesize, so it's not an owner.
  const joinOwners = new Map<string, Set<string>>()

  const groups: MigrationGroup[] = []
  for (const [name, defs] of byApp) {
    const deps = new Set<string>(getAppMeta(name)?.dependsOn ?? [])
    for (const def of defs) {
      for (const rel of def.relations) {
        if (rel.kind === 'belongsTo') {
          const target = getModelDefinition(rel.target())
          if (target?.app && target.app !== name) deps.add(target.app)
        } else if (rel.kind === 'manyToMany' && !rel.inverse) {
          const target = getModelDefinition(rel.target())
          if (!target) continue
          // The owning side synthesizes the join table, which FKs into the
          // target's table → if cross-app, this app depends on the target's app.
          if (target.app && target.app !== name) deps.add(target.app)
          const joinName = joinTableName(def.tableName, target.tableName, rel.through)
          let owners = joinOwners.get(joinName)
          if (!owners) joinOwners.set(joinName, (owners = new Set()))
          owners.add(name)
        }
      }
    }
    groups.push({name, models: defs.map(d => d.ctor), dependencies: [...deps], dir: getAppMeta(name)?.dir})
  }

  // Cross-app m2m guard: a join table synthesized by two DIFFERENT apps would be
  // created twice → a deploy collision. (Same-app both-sides is fine — one app,
  // deduped within its migration set.) Fail early with the fix.
  for (const [joinName, owners] of joinOwners) {
    if (owners.size > 1) {
      const apps = [...owners].map(a => `"${a}"`).join(' and ')
      throw new Error(
        `Cross-app many-to-many conflict: the join table "${joinName}" is synthesized by ` +
          `apps ${apps} — both would create it, colliding on deploy. Declare the relation on ` +
          `ONE side and mark the other side \`manyToMany(() => …, {inverse: true})\`.`
      )
    }
  }
  return groups
}

/**
 * Topologically order groups: every group comes after the groups it depends on.
 * Deterministic (siblings by name). Throws on a cycle or an unknown dependency.
 */
export function orderGroups(groups: MigrationGroup[]): MigrationGroup[] {
  const byName = new Map(groups.map(g => [g.name, g]))
  const out: MigrationGroup[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (g: MigrationGroup): void => {
    if (visited.has(g.name)) return
    if (visiting.has(g.name)) throw new Error(`Migration-group dependency cycle at "${g.name}".`)
    visiting.add(g.name)
    for (const dep of g.dependencies ?? []) {
      const d = byName.get(dep)
      if (!d) throw new Error(`Group "${g.name}" depends on unknown group "${dep}".`)
      visit(d)
    }
    visiting.delete(g.name)
    visited.add(g.name)
    out.push(g)
  }
  for (const g of [...groups].sort((x, y) => x.name.localeCompare(y.name))) visit(g)
  return out
}

/** Resolve a group's model classes to their registered definitions (the scoping set). */
export function groupModelDefinitions(group: MigrationGroup): ModelDefinition[] {
  return (group.models ?? []).map(getModelDefinitionOrThrow)
}

/**
 * A `MigrationRunner` scoped to one group: its own directory + models + ledger
 * namespace, resolving cross-group FK targets against the global registry universe.
 */
export function groupRunner(group: MigrationGroup, opts: {now?: () => string} = {}): MigrationRunner {
  if (!group.dir) {
    throw new Error(`Migration group "${group.name}" has no directory configured.`)
  }
  const defs = groupModelDefinitions(group)
  return new MigrationRunner({
    dir: group.dir,
    current: () => {
      const ir = toIR(defs)
      return {version: ir.version, entities: ir.entities}
    },
    resolveAgainst: () => toIR().entities,
    ledgerPrefix: group.name,
    now: opts.now
  })
}

/** Generate a migration for ONE group (scoped to its own tables). */
export function generateGroup(
  group: MigrationGroup,
  name: string,
  load: MigrationLoader,
  opts: {
    renames?: GeneratedMigration['renameCandidates']
    tableRenames?: GeneratedMigration['tableRenameCandidates']
    now?: () => string
  } = {}
): Promise<GeneratedMigration | null> {
  return groupRunner(group, {now: opts.now}).generate(name, load, {
    renames: opts.renames,
    tableRenames: opts.tableRenames
  })
}

export interface GroupApplyResult {
  group: string
  applied: string[]
}

/**
 * Re-point the migration ledger after an app was RENAMED (`fromApp` → `toApp`).
 * Ledger rows are keyed `"<app>:<name>"`, so a rename orphans the old app's
 * already-applied rows and `migrate` would re-run its init. Run once per database
 * (before `migrate`). Returns the number of ledger rows re-pointed. Idempotent.
 */
export async function renameGroupApp(
  groups: MigrationGroup[],
  fromApp: string,
  toApp: string,
  db: Database = getDatabase()
): Promise<number> {
  const group = groups.find(g => g.name === toApp)
  if (!group) {
    throw new Error(`No app named "${toApp}" — rename the app in code first, then run rename-app.`)
  }
  return groupRunner(group).renameAppLedger(fromApp, db)
}

/** Apply every group's pending migrations, in dependency order. Idempotent. */
/** Apply every group's pending migrations INTERLEAVED by global timestamp (see
 *  `MigrationRunner.applyGroupsInterleaved` — group-by-group can't build a fresh DB when
 *  a dependency gained a later migration a dependent's earlier one relies on). Returns
 *  the applied names regrouped per app, in dependency order, for the CLI. */
async function applyOrdered(
  groups: MigrationGroup[],
  load: MigrationLoader,
  db: Database
): Promise<GroupApplyResult[]> {
  const ordered = orderGroups(groups)
  const runners = ordered.map(g => ({
    runner: groupRunner(g),
    group: g.name,
  }))
  const byGroup = await MigrationRunner.applyGroupsInterleaved(runners, load, db)
  return ordered.map(g => ({group: g.name, applied: byGroup.get(g.name) ?? []}))
}

export async function migrateGroups(
  groups: MigrationGroup[],
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<GroupApplyResult[]> {
  return applyOrdered(groups, load, db)
}

/**
 * Production apply across groups: a GUARD pass first (every group must have no
 * uncaptured model changes and no tampered history), then apply in dependency
 * order — so a multi-group deploy is all-or-nothing at the gate.
 */
export async function deployGroups(
  groups: MigrationGroup[],
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<GroupApplyResult[]> {
  const ordered = orderGroups(groups)
  for (const group of ordered) {
    const runner = groupRunner(group)
    const status = await runner.status(load, db)
    if (status.pendingChanges.length > 0) {
      throw new Error(
        `Refusing to deploy group "${group.name}": uncaptured model changes — ` +
          `generate and commit its migration first.`
      )
    }
    const tampered = await runner.integrityErrors(load, db)
    if (tampered.length > 0) {
      throw new Error(`Refusing to deploy group "${group.name}": tampered migration(s): ${tampered.join(', ')}`)
    }
  }
  // All groups passed the gate → apply interleaved by global timestamp (same order a
  // fresh build needs), all-or-nothing under one lock.
  return applyOrdered(groups, load, db)
}

export interface GroupStatus {
  group: string
  pendingChanges: number
  unapplied: string[]
}

/** Per-group status (uncaptured changes + unapplied migrations), in dependency order. */
export async function statusGroups(
  groups: MigrationGroup[],
  load: MigrationLoader,
  db?: Database
): Promise<GroupStatus[]> {
  const out: GroupStatus[] = []
  for (const group of orderGroups(groups)) {
    const status = await groupRunner(group).status(load, db)
    out.push({group: group.name, pendingChanges: status.pendingChanges.length, unapplied: status.unapplied})
  }
  return out
}
