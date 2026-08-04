# Docs coverage check

Diffs Pylon's **feature surface** (extracted from source) against the **docs corpus**
(`content/docs/**/*.md`) and fails when a public feature has no documentation. This is
the guard that keeps the docs from silently falling behind the code.

```bash
pnpm --filter @getcronit/pylon-docs check:coverage
# or, from docs/:
node coverage/check.mjs
```

Exit code is non-zero if any hard check fails — wire it into CI.

## What it checks

| Check | Source of truth | Fails when |
|---|---|---|
| **A. API** | public `export`s of the user-facing packages + the pylon-db `models`/`db`/`migrations` namespace objects | a public symbol is never mentioned in the docs |
| **B. CLI** | `.command('…')` calls in `pylon-dev` | a `pylon` (sub)command is missing from `reference/cli.md` |
| **C. Config** | the `PylonConfig` type | a config key is missing from `reference/config.md` |
| **D. Rot** *(advisory)* | package exports | a docs code block imports a name the package no longer exports |

Almost everything is **extracted mechanically**, so a newly-added export (e.g. a new
`models.*` field type) is picked up automatically — the check goes red until it's either
documented or explicitly marked internal. Nothing to keep in sync by hand except:

## The one hand-maintained file: `registry.mjs`

It records only what can't be derived from source:

- **`internal` / `internalMembers`** — exported symbols that are plumbing, not
  user-facing features, so they're not expected in the docs. Adding a symbol here is an
  explicit "this is internal" decision. The check has no separate allowlist that can rot:
  a new export is either documented or listed here, or it fails.
- **`publicFlat`** (pylon-db only) — the handful of *flat* pylon-db exports that are
  public. pylon-db's flat surface is mostly low-level internals ("used internally and by
  the build bridge" — its own words), so that package is allowlist-driven; its everyday
  API is the `models`/`db`/`migrations` namespaces, which are read automatically.

### When the check fails, you have two honest choices

1. **Document it** — add/extend a page under `content/docs/` that mentions the symbol
   (the qualified form `models.Struct`, the flat builder `hasMany`, or the bare name all
   count as coverage).
2. **Mark it internal** — add it to `internal` / `internalMembers` in `registry.mjs`
   with a one-line reason.

Coverage means "the symbol appears somewhere in the docs" — a cheap, robust proxy, not
proof the prose is good. For the stronger "the examples still resolve against the current
API" guarantee, see the companion below.

## `check-examples.mjs` — type-aware example check (advisory)

```bash
node coverage/check-examples.mjs      # needs the packages built: `pnpm build`
```

Concatenates each page's ```ts fences into one virtual module and type-checks it against
the packages' shipped `.d.ts` (via a paths map — no install needed). Because doc snippets
are fragments, it reports **only** the diagnostics that reliably mean API drift:

- `TS2305` / `TS2724` — an `import { X }` of a member the package no longer exports.
- `TS2307` — a dead `@getcronit/*` module/subpath (relative and third-party misses are
  expected and ignored).

Member-level checks (`TS2339` "property does not exist") are **off by default**: Pylon
leans on dynamic types the snippets can't reconstruct (the ORM's `static objects =
manager()`, relation managers, the app-generated `Data`/`Mutations`/`Bindings` types), so
`2339` is almost all false positives here. Flip `ENABLE_MEMBER_CHECKS` in the script if
you make the snippets self-contained enough to trust it.

Kept out of the `check:coverage` gate on purpose — it depends on build state and is
fuzzier than the mention check. Run it in CI as a separate, non-blocking step, or promote
it once the docs are green.
