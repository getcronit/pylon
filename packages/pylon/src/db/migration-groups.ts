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
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {describeChange, joinTableName, type CastHint} from '../ir'
import type {Database} from './database.js'
import {getDatabase} from './database.js'
import {toIR} from './ir.js'
import {
  MigrationRunner,
  type GeneratedMigration,
  type MigrationLoader
} from './migration-runner.js'
import type {MigrationDependency, MigrationModule} from './migration-ops.js'
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
  /**
   * The implicit DEFAULT app of a project with no `models.app()` tags: every model,
   * the root `./migrations` dir, and — crucially — a BARE ledger (no `<name>:` prefix),
   * so an existing non-apps project's already-applied rows keep matching. It lets the
   * whole CLI run one uniform apps path instead of a second root-runner code path.
   */
  root?: boolean
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
 * Best-effort topological order of groups: every group comes after the groups it
 * depends on where the graph allows it. Deterministic (siblings by name). Throws on
 * an unknown dependency; TOLERATES a cycle.
 *
 * Whole-group acyclicity is deliberately NOT required. A legitimate mutual cross-app
 * FK (e.g. `tickets.TicketEvent.relatedTaskId → tasks` AND
 * `tasks.TaskEvent.relatedTicketId → tickets`) makes the two GROUPS mutually
 * dependent, but that is still applyable: `MigrationRunner.applyGroupsInterleaved`
 * orders the individual MIGRATIONS by the tables they create vs. reference, so as
 * long as the two FK directions live in different migrations (the normal case — one
 * side was added later) there is a valid migration order even though the group graph
 * has a cycle. A genuinely unresolvable ordering (two migrations that each need a
 * table the other creates) is caught there with a precise error.
 *
 * So this function only needs to produce a deterministic, reasonable order for
 * building runners and reporting — it must not reject an applyable schema. On a back
 * edge we simply skip it (break the cycle) instead of throwing.
 */
export function orderGroups(groups: MigrationGroup[]): MigrationGroup[] {
  const byName = new Map(groups.map(g => [g.name, g]))
  const out: MigrationGroup[] = []
  const onStack = new Set<string>()
  const visited = new Set<string>()
  const visit = (g: MigrationGroup): void => {
    if (visited.has(g.name)) return
    // Back edge → part of a cycle. Skip it: the interleaved apply resolves the real
    // ordering at migration granularity (see the doc comment above).
    if (onStack.has(g.name)) return
    onStack.add(g.name)
    for (const dep of g.dependencies ?? []) {
      const d = byName.get(dep)
      if (!d) throw new Error(`Group "${g.name}" depends on unknown group "${dep}".`)
      visit(d)
    }
    onStack.delete(g.name)
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
  // The default (root) group is every model with a BARE ledger — identical to the
  // pre-apps root runner, so existing non-apps histories keep applying unchanged.
  const defs = group.root ? undefined : groupModelDefinitions(group)
  return new MigrationRunner({
    dir: group.dir,
    current: () => {
      const ir = defs ? toIR(defs) : toIR()
      return {version: ir.version, entities: ir.entities}
    },
    resolveAgainst: () => toIR().entities,
    ledgerPrefix: group.root ? undefined : group.name,
    now: opts.now
  })
}

/**
 * Resolve a physical table to the `[app, migration]` in one of `siblings` that
 * creates it — the source of persisted cross-app dependency edges. Scans only OTHER
 * apps' on-disk histories (same-app ordering is the intra-app sequence). Later
 * creators win, matching apply-time state (a dropped + recreated table resolves to
 * the latest). Generation must run in dependency order so a depended-upon app's
 * migration is already on disk when its dependent is generated.
 */
async function crossAppCreatorFor(
  self: MigrationGroup,
  siblings: MigrationGroup[],
  load: MigrationLoader
): Promise<(table: string) => readonly [string, string] | undefined> {
  const map = new Map<string, [string, string]>()
  for (const g of siblings) {
    if (g.name === self.name || !g.dir) continue
    for (const {name, mod} of await groupRunner(g).loadAll(load)) {
      for (const op of mod.operations) {
        for (const ch of (op.changes ?? []) as Array<Record<string, any>>) {
          if (ch.kind === 'createTable') map.set(ch.spec.table, [g.name, name])
          else if (ch.kind === 'renameTable') map.set(ch.toTable, [g.name, name])
        }
      }
    }
  }
  return table => map.get(table)
}

/** Generate a migration for ONE group (scoped to its own tables). Pass `siblings`
 *  (all groups) so cross-app references become persisted `[app, migration]` edges. */
export async function generateGroup(
  group: MigrationGroup,
  name: string,
  load: MigrationLoader,
  opts: {
    renames?: GeneratedMigration['renameCandidates']
    tableRenames?: GeneratedMigration['tableRenameCandidates']
    castHints?: CastHint[]
    now?: () => string
    siblings?: MigrationGroup[]
  } = {}
): Promise<GeneratedMigration | null> {
  const crossAppCreator = opts.siblings
    ? await crossAppCreatorFor(group, opts.siblings, load)
    : undefined
  return groupRunner(group, {now: opts.now}).generate(name, load, {
    renames: opts.renames,
    tableRenames: opts.tableRenames,
    castHints: opts.castHints,
    crossAppCreator
  })
}

export interface GroupApplyResult {
  group: string
  applied: string[]
}

/**
 * Replace the `dependencies:` array value in a migration file's source with
 * `newDeps` (serialized as JSON). A balanced-bracket scan from the first `[` after
 * the key makes it robust to formatting and quote style. Only the deps array is
 * touched; the rest of the file (operations, comments) is left byte-for-byte.
 */
async function rewriteDepsInFile(file: string, newDeps: MigrationDependency[]): Promise<void> {
  const text = await fs.readFile(file, 'utf8')
  const key = text.indexOf('dependencies:')
  if (key < 0) return
  const open = text.indexOf('[', key)
  if (open < 0) return
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return
  await fs.writeFile(file, text.slice(0, open) + JSON.stringify(newDeps) + text.slice(end + 1))
}

/**
 * Re-point everything that names an app after it was RENAMED (`fromApp` → `toApp`):
 *
 *  1. The migration LEDGER — rows are keyed `"<app>:<name>"`, so a rename orphans the
 *     old app's applied rows and `migrate` would re-run its init.
 *  2. Cross-app dependency TUPLES — a `[fromApp, name]` edge in any app's migration
 *     files (the persisted cross-app graph) would otherwise dangle and fail loudly.
 *     Bare (same-app) deps are relative and need no rewrite. Rewrites the files across
 *     every app in `groups`.
 *
 * Run once per database (before `migrate`). Returns the number of ledger rows
 * re-pointed. Idempotent — a second run finds no `fromApp` tuples and no old rows.
 */
export async function renameGroupApp(
  groups: MigrationGroup[],
  fromApp: string,
  toApp: string,
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<number> {
  const group = groups.find(g => g.name === toApp)
  if (!group) {
    throw new Error(`No app named "${toApp}" — rename the app in code first, then run rename-app.`)
  }

  for (const g of groups) {
    if (!g.dir) continue
    let files: string[]
    try {
      files = (await fs.readdir(g.dir)).filter(f => f.endsWith('.ts'))
    } catch {
      continue // no migrations dir yet
    }
    for (const f of files) {
      const file = path.join(g.dir, f)
      const mod = (await load(file)) as MigrationModule
      const deps = mod.dependencies
      if (!deps?.some(d => Array.isArray(d) && d[0] === fromApp)) continue
      const rewritten = deps.map(d =>
        Array.isArray(d) && d[0] === fromApp ? ([toApp, d[1]] as const) : d
      )
      await rewriteDepsInFile(file, rewritten as MigrationDependency[])
    }
  }

  return groupRunner(group).renameAppLedger(fromApp, db)
}

/**
 * Squash ONE group's history into a single migration, then cascade-rewrite any
 * cross-app dependency tuple in a SIBLING app that named a now-collapsed migration
 * to the squashed one — otherwise the persisted graph dangles (and fails loudly at
 * apply). Same reconciliation `rename-app` does, for the squash case.
 */
export async function squashGroups(
  groups: MigrationGroup[],
  groupName: string,
  load: MigrationLoader,
  name = 'squashed',
  db?: Database
): Promise<{name: string; replaced: string[]} | null> {
  const group = groups.find(g => g.name === groupName)
  if (!group) {
    throw new Error(
      `Unknown app "${groupName}" (apps: ${groups.map(g => g.name).join(', ')}).`
    )
  }
  const result = await groupRunner(group).squash(load, name, db)
  if (!result) return null

  const replaced = new Set(result.replaced)
  const hits = (d: MigrationDependency): boolean =>
    Array.isArray(d) && d[0] === group.name && replaced.has(d[1])
  for (const g of groups) {
    if (g.name === group.name || !g.dir) continue
    let files: string[]
    try {
      files = (await fs.readdir(g.dir)).filter(f => f.endsWith('.ts'))
    } catch {
      continue
    }
    for (const f of files) {
      const file = path.join(g.dir, f)
      const mod = (await load(file)) as MigrationModule
      const deps = mod.dependencies
      if (!deps?.some(hits)) continue
      // Several collapsed edges fold to the one squashed migration — dedup.
      const seen = new Set<string>()
      const rewritten: MigrationDependency[] = []
      for (const d of deps) {
        const next = hits(d) ? ([group.name, result.name] as const) : d
        const key = Array.isArray(next) ? `${next[0]} ${next[1]}` : `#${next}`
        if (seen.has(key)) continue
        seen.add(key)
        rewritten.push(next as MigrationDependency)
      }
      await rewriteDepsInFile(file, rewritten)
    }
  }
  return result
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

/** Tampered migrations across every group, labelled `"<app>:<migration>"`. */
export async function integrityErrorsGroups(
  groups: MigrationGroup[],
  load: MigrationLoader,
  db: Database = getDatabase()
): Promise<string[]> {
  const out: string[] = []
  for (const group of orderGroups(groups)) {
    const bad = await groupRunner(group).integrityErrors(load, db)
    out.push(...bad.map(n => `${group.name}:${n}`))
  }
  return out
}

export interface GroupStatus {
  group: string
  pendingChanges: number
  /** One readable line per uncaptured change — so callers can report WHAT, not just how many. */
  pending: string[]
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
    out.push({
      group: group.name,
      pendingChanges: status.pendingChanges.length,
      pending: status.pendingChanges.map(describeChange),
      unapplied: status.unapplied
    })
  }
  return out
}
