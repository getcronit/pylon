/**
 * Migration round-trip / fuzz suite (Postgres).
 *
 * Proves the two things the existing runner ITs don't: that generated migrations
 * (a) reproduce the model state EXACTLY when folded (convergence), and (b) when
 * their SQL actually runs against Postgres, produce that shape — and reverse it
 * cleanly. Curated scenarios lock in known-risky paths; the seeded fuzz walks
 * explore combinations no hand-written case would. See `_migration-harness.ts`
 * for the invariants each `runRoundTrip` enforces.
 *
 * Gated on a reachable Postgres (DATABASE_URL or PYLON_ORM_IT), like the other
 * integration tests. Run: `pnpm --filter @getcronit/pylon/db test:integration`.
 */
import {afterAll, beforeAll, describe, it} from 'vitest'
import {connect, type Database} from '@/db/index'
import {
  belongsToField,
  entity,
  randomWalk,
  runRoundTrip,
  scalarField,
  snap,
  type WalkStep
} from './_migration-harness'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// A curated step is just its target state + a label; helper keeps scenarios terse.
const step = (label: string, ...entities: ReturnType<typeof entity>[]): WalkStep => ({
  label,
  state: snap(entities)
})

describe.skipIf(!runDb)('migration round-trip — curated scenarios (Postgres)', () => {
  let db: Database
  beforeAll(() => {
    db = connect({connectionString})
  })
  afterAll(async () => {
    if (db) await db.destroy()
  })

  it('create table, add columns, alter, drop — round-trips', async () => {
    const A0 = entity('Alpha', 'alpha', [scalarField('title', 'title', 'text')])
    const A1 = entity('Alpha', 'alpha', [
      scalarField('title', 'title', 'text'),
      scalarField('count', 'count', 'integer', {nullable: true})
    ])
    // alter: title becomes unique, count becomes non-null
    const A2 = entity('Alpha', 'alpha', [
      scalarField('title', 'title', 'text', {unique: true}),
      scalarField('count', 'count', 'integer')
    ])
    // drop count
    const A3 = entity('Alpha', 'alpha', [scalarField('title', 'title', 'text', {unique: true})])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-cols-',
      steps: [step('init', A0), step('add_count', A1), step('alter', A2), step('drop_count', A3)]
    })
  })

  it('foreign key add + drop across two tables — round-trips', async () => {
    const Author = entity('Author', 'author', [scalarField('name', 'name', 'text')])
    const post = (withFk: boolean) =>
      entity(
        'Post',
        'post',
        withFk
          ? [
              scalarField('title', 'title', 'text'),
              scalarField('authorId', 'author_id', 'bigint', {nullable: true}),
              belongsToField('author', 'authorId', 'Author', 'set null')
            ]
          : [scalarField('title', 'title', 'text')]
      )
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-fk-',
      steps: [
        step('authors', Author),
        step('posts', Author, post(false)),
        step('link', Author, post(true)),
        step('unlink', Author, post(false))
      ]
    })
  })

  // Regression: retyping a column joined by a FK (the referenced PK AND the
  // referencing column, together) must drop the constraint before the type changes
  // and re-add it after. With the FK left in place, Postgres re-validates it against
  // the momentarily-mismatched types and aborts ("constraint cannot be implemented").
  // Loc has a varchar PK that Child.loc_id references; the step retypes both varchar
  // → text. (varchar↔text casts implicitly both ways, so `down` reverses too.)
  it('retype a FK-joined column (referenced PK + referencing column) — round-trips', async () => {
    const locId = (t: string) => ({
      name: 'id',
      type: {kind: 'scalar', name: 'String', nullable: false} as never,
      exposed: true,
      column: {name: 'id', sqlType: t, primaryKey: true, autoIncrement: false, unique: false, nullable: false}
    })
    const Loc = (t: string) =>
      ({
        name: 'Loc', table: 'loc', abstract: false, primaryKey: 'id', implements: [],
        fields: [locId(t), scalarField('name', 'name', 'text')]
      }) as unknown as ReturnType<typeof entity>
    const Child = (t: string) =>
      entity('Child', 'child', [
        scalarField('locId', 'loc_id', t, {nullable: true}),
        belongsToField('loc', 'locId', 'Loc', 'set null')
      ])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-fk-retype-',
      steps: [
        step('init', Loc('varchar'), Child('varchar')),
        step('retype', Loc('text'), Child('text'))
      ]
    })
  })

  // Regression: dropping a column that carries a FK must cascade in the fold
  // (Postgres DROP COLUMN cascades the constraint) — else `status` reports a
  // phantom pending `dropForeignKey` forever. Found by the fuzzer.
  it('drop a FK-bearing column cascades (no phantom pending change) — round-trips', async () => {
    const Author = entity('Author', 'author', [scalarField('name', 'name', 'text')])
    const post = (withFk: boolean) =>
      entity(
        'Post',
        'post',
        withFk
          ? [
              scalarField('title', 'title', 'text'),
              scalarField('authorId', 'author_id', 'bigint', {nullable: true}),
              belongsToField('author', 'authorId', 'Author', 'set null')
            ]
          : [scalarField('title', 'title', 'text')]
      )
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-dropfkcol-',
      steps: [
        step('authors', Author),
        step('posts_linked', Author, post(true)),
        // drop the FK column AND relation in one step — the fold must drop the FK
        step('drop_author_col', Author, post(false))
      ]
    })
  })

  // Regression: renaming a table that is an FK TARGET. Postgres auto-updates FKs
  // referencing the renamed table, so the diff/fold must too — otherwise a later
  // migration emits a spurious FK drop/recreate that references the pre-rename
  // name and fails on rollback ("relation … does not exist"). Found by the fuzzer.
  it('rename an FK-target table, then keep migrating — round-trips', async () => {
    const author = (name: string, table: string) =>
      entity(name, table, [scalarField('name', 'name', 'text')])
    const post = (target: string, extra?: ReturnType<typeof scalarField>) =>
      entity('Post', 'post', [
        scalarField('title', 'title', 'text'),
        ...(extra ? [extra] : []),
        scalarField('authorId', 'author_id', 'bigint', {nullable: true}),
        belongsToField('author', 'authorId', target, 'set null')
      ])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-renametarget-',
      steps: [
        step('init', author('Author', 'author'), post('Author')),
        // rename Author -> Writer; Post's FK must follow to `writer`
        {
          label: 'rename_author_writer',
          state: snap([author('Writer', 'writer'), post('Writer')]),
          tableRenames: [{from: 'Author', to: 'Writer'}]
        },
        // a later, unrelated change must NOT resurrect a stale FK reconciliation
        step('add_post_col', author('Writer', 'writer'), post('Writer', scalarField('body', 'body', 'text', {nullable: true})))
      ]
    })
  })

  // Regression: a column-level UNIQUE (or CHECK) constraint dropped out-of-band
  // via cascade (its table dropped, then re-created without it) must not make a
  // later drop/rollback abort — the constraint drop must be `IF EXISTS`, like the
  // FK/index drops. Found by the fuzzer.
  it('toggle column UNIQUE, drop the table, re-create — round-trips', async () => {
    const beta = (unique: boolean) =>
      entity('Beta', 'beta', [scalarField('code', 'code', 'text', {unique})])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-uniqcascade-',
      steps: [
        step('init', beta(false)),
        step('make_unique', beta(true)),
        // drop the table entirely (cascades the unique constraint) …
        step('drop_beta'),
        // … then re-create it unique again: rollback must tolerate the vanished constraint
        step('recreate_unique', beta(true))
      ]
    })
  })

  it('index add + drop, and unique index — round-trips', async () => {
    const base = (indexes: {name: string; columns: string[]; unique?: boolean}[]) =>
      entity(
        'Gamma',
        'gamma',
        [scalarField('slug', 'slug', 'text'), scalarField('kind', 'kind', 'text')],
        indexes.map(ix => ({...ix, table: 'gamma'}))
      )
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-idx-',
      steps: [
        step('init', base([])),
        step('add_idx', base([{name: 'gamma_slug_idx', columns: ['slug']}])),
        step(
          'add_unique',
          base([
            {name: 'gamma_slug_idx', columns: ['slug']},
            {name: 'gamma_kind_key', columns: ['kind'], unique: true}
          ])
        ),
        step('drop_idx', base([{name: 'gamma_kind_key', columns: ['kind'], unique: true}]))
      ]
    })
  })

  // Regression: renaming a column that carries a UNIQUE constraint. Postgres keeps
  // the constraint's OLD name (`<table>_<old>_key`), but the model derives the new
  // one — so the diff must emit RENAME CONSTRAINT. Without it, a later "drop unique"
  // silently misses (IF EXISTS no-ops on the wrong name) and the constraint lingers.
  it('rename a UNIQUE column, then drop the unique — round-trips (no constraint drift)', async () => {
    const delta = (col: string, unique: boolean) =>
      entity('Delta', 'delta', [scalarField(col, col, 'text', {unique})])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-renuniq-',
      steps: [
        step('init', delta('code', true)),
        // rename the unique column code -> sku (constraint must follow)
        {
          label: 'rename_code_sku',
          state: snap([delta('sku', true)]),
          renames: [{table: 'delta', from: 'code', to: 'sku'}]
        },
        // now drop the uniqueness — must actually remove the constraint, not a stale name
        step('drop_unique', delta('sku', false))
      ]
    })
  })

  it('rename column (data-preserving hint) — round-trips', async () => {
    const before = entity('Delta', 'delta', [scalarField('label', 'label', 'text')])
    const after = entity('Delta', 'delta', [scalarField('caption', 'caption', 'text')])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-rencol-',
      steps: [
        step('init', before),
        {
          label: 'rename_label_caption',
          state: snap([after]),
          renames: [{table: 'delta', from: 'label', to: 'caption'}]
        }
      ]
    })
  })

  it('rename table (data-preserving hint) — round-trips', async () => {
    const before = entity('Beta', 'beta', [scalarField('title', 'title', 'text')])
    const after = entity('Renamed', 'renamed', [scalarField('title', 'title', 'text')])
    await runRoundTrip({
      db,
      dirPrefix: 'pylon-rt-rentab-',
      steps: [
        step('init', before),
        {
          label: 'rename_beta_renamed',
          state: snap([after]),
          tableRenames: [{from: 'Beta', to: 'Renamed'}]
        }
      ]
    })
  })
})

describe.skipIf(!runDb)('migration round-trip — seeded fuzz (Postgres)', () => {
  let db: Database
  beforeAll(() => {
    db = connect({connectionString})
  })
  afterAll(async () => {
    if (db) await db.destroy()
  })

  // Fixed seeds → deterministic walks. A failure prints its seed; reproduce by
  // narrowing to that seed. Add seeds here as the space grows; keep them fixed so
  // CI is reproducible (not a moving target that flakes on unrelated changes).
  // Fixed seeds → deterministic walks. Chosen from a much larger sweep (the
  // harness has been run over 100+ seeds × 20+ steps); this committed subset keeps
  // CI fast while covering the diff paths that historically broke. Keep them fixed
  // so CI is reproducible — a failure prints its seed to reproduce locally.
  const SEEDS = [
    1, 2, 3, 7, 11, 13, 42, 94, 99, 101, 108, 115, 178, 206, 248, 256, 332, 409,
    528, 542, 619, 668, 777, 2024, 31337, 8675309
  ]
  const STEPS = 18

  for (const seed of SEEDS) {
    it(`walk seed=${seed} (${STEPS} steps) round-trips`, async () => {
      const steps = randomWalk(seed, STEPS)
      await runRoundTrip({db, dirPrefix: `pylon-rt-fuzz-${seed}-`, steps})
    })
  }
})
