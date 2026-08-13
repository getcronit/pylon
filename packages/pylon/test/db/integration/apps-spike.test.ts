/**
 * APPS SPIKE — pressure-test the riskiest assumptions of the Pylon "apps" design
 * BEFORE building the feature (see memory: pylon_apps_system_design.md).
 *
 * The thesis: a Django-style multi-app layout (each app owns its models +
 * migration dir) needs NO deep MigrationRunner surgery — just orchestration —
 * because:
 *   - the ORM registry is global, so `toIR(appDefs)` scopes IR to one app, and
 *   - `MigrationRunner.current` is injectable, so a per-app runner generates only
 *     that app's tables, while a cross-app FK still resolves (its refTable is the
 *     globally-registered target model's table).
 *
 * Two "apps": `auth` (User) and `blog` (Post, FK→User). If this is green using
 * only `current` injection + ordered apply, apps support is mostly wiring.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {mergeIR} from '@getcronit/pylon/ir'
import {
  type ModelConfig,
  Model,
  connect,
  Database,
  foreignKey,
  getModelDefinitionOrThrow,
  id,
  manager,
  setDefaultDatabase,
  text,
  toIR,
  MigrationRunner,
  type MigrationLoader,
  type Relation,
  type Snapshot
} from '@/db/index'

// ── app: auth ────────────────────────────────────────────────────────────────
class User extends Model {
  static config = {table: 'app_user'} satisfies ModelConfig<User>
  static objects = manager(User)
  id = id()
  email = text()
}
new Pylon({db: {models: [User]}})

// ── app: blog (depends on auth) ──────────────────────────────────────────────
class Post extends Model {
  static config = {table: 'app_post'} satisfies ModelConfig<Post>
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
}
new Pylon({db: {models: [Post]}})

const authDefs = () => [getModelDefinitionOrThrow(User)]
const blogDefs = () => [getModelDefinitionOrThrow(Post)]
const snap = (defs: ReturnType<typeof authDefs>): Snapshot => {
  const ir = toIR(defs)
  return {version: ir.version, entities: ir.entities}
}

// vitest transpiles the generated .ts migration files on dynamic import.
const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('SPIKE A — multi-source IR federation (no DB)', () => {
  it('mergeIR over two app IRs yields both entities (variadic merge)', () => {
    const merged = mergeIR(toIR(authDefs()), toIR(blogDefs()))
    expect(Object.keys(merged.entities).sort()).toEqual(['Post', 'User'])
    // The blog entity carries its FK relation; the auth entity is independent.
    expect(merged.entities.User.table).toBe('app_user')
    expect(merged.entities.Post.table).toBe('app_post')
  })
})

describe.skipIf(!runDb)('SPIKE B — per-app migrations scoped via `current` (Postgres)', () => {
  let db: Database
  let authDir: string
  let blogDir: string
  let authRunner: MigrationRunner
  let blogRunner: MigrationRunner

  const cleanDb = async () => {
    await db.kysely.schema.dropTable('app_post').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('app_user').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
  }

  beforeAll(async () => {
    db = connect({connectionString})
    await cleanDb()
    authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-app-auth-'))
    blogDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-app-blog-'))
    // Each runner is scoped to its own app's models + a distinct timestamp so the
    // SHARED ledger doesn't collide on the migration-name PK.
    // Per-app `current` (scoped), but FKs resolve against the GLOBAL registry
    // universe — so blog's FK→app_user resolves even though User is another app.
    const universe = () => toIR().entities
    authRunner = new MigrationRunner({
      dir: authDir,
      current: () => snap(authDefs()),
      resolveAgainst: universe,
      now: () => '20260101T000001'
    })
    blogRunner = new MigrationRunner({
      dir: blogDir,
      current: () => snap(blogDefs()),
      resolveAgainst: universe,
      now: () => '20260101T000002'
    })
  })

  afterAll(async () => {
    if (db) {
      await cleanDb()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
    await fs.rm(authDir, {recursive: true, force: true})
    await fs.rm(blogDir, {recursive: true, force: true})
  })

  it('auth `generate` emits ONLY app_user (scoped, no app_post)', async () => {
    const gen = await authRunner.generate('init', load)
    expect(gen).not.toBeNull()
    const created = gen!.changes.filter(c => c.kind === 'createTable').map(c => (c as any).spec.table)
    expect(created).toEqual(['app_user'])
  })

  it('blog `generate` emits ONLY app_post + a cross-app FK→app_user (no app_user table)', async () => {
    const gen = await blogRunner.generate('init', load)
    expect(gen).not.toBeNull()
    const created = gen!.changes.filter(c => c.kind === 'createTable').map(c => (c as any).spec.table)
    expect(created).toEqual(['app_post']) // crucially NOT app_user — scoping holds

    const fks = gen!.changes.filter(c => c.kind === 'addForeignKey').map(c => (c as any).fk)
    expect(fks).toHaveLength(1)
    expect(fks[0].table).toBe('app_post')
    expect(fks[0].refTable).toBe('app_user') // FK resolves across apps
  })

  it('applies auth THEN blog → cross-app FK is real (good ref ok, bad ref rejected)', async () => {
    expect(await authRunner.apply(load, db)).toEqual(['20260101T000001_init'])
    expect(await blogRunner.apply(load, db)).toEqual(['20260101T000002_init'])

    const user = await User.objects.create({email: 'ada@x.co'})
    const post = await Post.objects.create({title: 'Hello', authorId: user.id})
    expect(post.id).toBeTypeOf('number')

    // FK enforced at the DB: a dangling authorId is rejected.
    await expect(
      Post.objects.create({title: 'Orphan', authorId: 9_999_999})
    ).rejects.toThrow(/foreign key|violates|app_post_author_id/i)
  })

  it('both apps coexist in the SHARED ledger (distinct names, no collision)', async () => {
    const rows = await db.kysely
      .selectFrom('_pylon_migrations' as never)
      .select('name' as never)
      .execute()
    // Scope to this spike's own rows (the ledger is shared with other tests).
    const names = (rows as Array<{name: string}>)
      .map(r => r.name)
      .filter(n => n.startsWith('20260101T'))
      .sort()
    expect(names).toEqual(['20260101T000001_init', '20260101T000002_init'])
  })
})
