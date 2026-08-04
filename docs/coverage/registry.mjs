// docs/coverage/registry.mjs
//
// The ONE hand-maintained artifact behind the docs coverage check.
//
// Everything else — the list of features that must be documented — is EXTRACTED
// from source (package exports, the pylon-db `models`/`db`/`migrations` namespace
// objects, CLI `.command()` calls, the `PylonConfig` type). This file only records
// the two things that can't be derived mechanically:
//
//   1. `internal`  — exported symbols that are plumbing, not user-facing features,
//                    so they are NOT expected to appear in the docs. Adding a symbol
//                    here is an explicit "this is internal" decision; the drift guard
//                    fails on any export that is neither documented nor listed here,
//                    so the list can't silently rot.
//   2. `publicFlat`— for pylon-db only, the handful of FLAT exports that ARE public
//                    (the bulk of pylon-db's flat exports are low-level internals, so
//                    that package is allowlist-driven instead of denylist-driven).
//
// Paths are relative to the repo root.

export const REPO_ROOT_FROM_HERE = '../..'

// Where the rendered docs live (markdown-as-data corpus).
export const DOCS_GLOB_DIR = 'docs/content/docs'
export const CLI_DOC = 'docs/content/docs/reference/cli.md'
export const CONFIG_DOC = 'docs/content/docs/reference/config.md'

// The user-facing packages whose public surface the docs must cover.
export const PACKAGES = {
  '@getcronit/pylon': {
    // Small, mostly-public export list → denylist mode (all exports − internal).
    entries: ['packages/pylon/src/index.ts'],
    mode: 'all-minus-internal',
    // Build/runtime plumbing the docs intentionally don't teach as features.
    internal: [
      'executeConfig', // internal boot hook (codegen calls it)
      'handler', // internal request handler factory
      'getResolveInfo', // low-level GraphQL resolve-info escape hatch
      'asyncContext' // AsyncLocalStorage primitive behind getContext
    ]
  },

  '@getcronit/pylon-db': {
    // The recommended public API is the namespace objects; the flat exports are
    // "Low-level surface, used internally and by the build bridge" (their words),
    // so pylon-db is allowlist-driven.
    entries: ['packages/pylon-db/src/index.ts'],
    mode: 'namespaces-plus-list',
    namespaces: [
      // namespace name → the object literal to read its members from.
      { name: 'models', object: 'modelBuilders' }, // `export const models = {...modelBuilders}`
      { name: 'db', object: 'db' },
      { name: 'migrations', object: 'migrations' }
    ],
    // Namespace MEMBERS that are low-level workflow internals (what the `pylon db`
    // CLI drives under the hood), not something a user hand-writes → not expected in
    // prose. Matched as `namespace.member`.
    internalMembers: [
      'migrations.snapshot',
      'migrations.serializeSnapshot',
      'migrations.loadSnapshot',
      'migrations.saveSnapshot',
      'migrations.planMigration',
      'migrations.applyMigration',
      'migrations.isReversible',
      'migrations.MigrationRunner',
      'db.setDefaultDatabase', // wiring seam; docs teach db.connect
      'db.onCommit', // low-level tx hook; docs teach signals
      'db.syncSchema', // programmatic guts of `pylon db push` (the documented UX)
      'db.dropTables', // ditto — test/prototyping teardown
      // Relation return-type classes: users interact with instances (.filter/.add/…),
      // documented behaviorally in data/relations; the class names aren't authored.
      'models.RelatedManager',
      'models.ManyToManyManager'
    ],
    // Flat exports that genuinely ARE public features (the rest of pylon-db's flat
    // surface is low-level internals — see the file header).
    publicFlat: [
      'useDatabase',
      'gate',
      'authorize',
      'can',
      'cannot',
      'filter',
      'defineFeatures',
      'requireFeature',
      'isFeatureEnabled',
      'featureValue',
      'runAsSystem',
      'currentTenant',
      'currentPrincipal',
      'signals',
      'ValidationError',
      'NotFoundError',
      'BadRequestError',
      'toGid',
      'fromGid',
      'isGid',
      'createId',
      'uuidv4',
      'snowflake'
    ]
  },

  '@getcronit/pylon-auth': {
    entries: [
      'packages/pylon-auth/src/index.ts',
      'packages/pylon-auth/src/zitadel.ts'
    ],
    mode: 'all-minus-internal',
    internal: [
      'getPrincipal' // low-level accessor; docs teach useIdentity/authorize
    ]
  },

  '@getcronit/pylon-pages': {
    // Two entries: the plugin (`/plugin` = pkg root export) and the browser runtime.
    entries: [
      'packages/pylon-pages/src/index.ts',
      'packages/pylon-pages/src/pages/index.ts'
    ],
    mode: 'all-minus-internal',
    internal: [
      'Gid' // client-side gid parser utility class; gid is surfaced via props/helpers
    ]
  },

  '@getcronit/pylon-queues': {
    entries: ['packages/pylon-queues/src/index.ts'],
    mode: 'all-minus-internal',
    internal: [
      'registeredQueues', // registry read used internally
      'setJobRunner', // test/runner seam
      'manager', // low-level manager accessor
      'getQueueDefinition',
      'QueueDefinition', // class returned by defineQueue; docs teach defineQueue
      'queuesOf', // IR-harvest seam (analogue of modelsOf), used by build tooling
      'setConnection',
      'closeConnection',
      'getConnection',
      'setOutboxDriver',
      'getOutboxDriver',
      'relayOnce' // single-tick relay; docs teach runOutboxRelay
    ]
  }
}

// pylon-db namespace members that are common English words — matching them as a
// bare token in prose would produce false "documented" positives, so the checker
// requires the QUALIFIED form (e.g. `models.Date`) for these.
export const QUALIFY_ONLY = new Set([
  'Date',
  'Boolean',
  'Array',
  'JSON',
  'Int',
  'Text',
  'Number'
])

// CLI: source of the command registry, and commands that are internal/experimental
// and not expected in the CLI reference page.
export const CLI_SOURCE = 'packages/pylon-dev/src/index.ts'
export const CLI_INTERNAL = [
  'eval' // agent A/B eval harness — internal tooling, not a user command
]

// Config: the type whose keys the config reference must document.
export const CONFIG_SOURCE = 'packages/pylon/src/index.ts'
export const CONFIG_TYPE = 'PylonConfig'
