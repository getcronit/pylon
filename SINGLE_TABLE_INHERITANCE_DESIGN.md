# Single-Table Inheritance (STI) for pylon-db

**Status:** proposed · **Owner:** platform · **Depends on:** the schema analyzer's existing `extends → interface` support

One-line: let a pylon-db model be **subclassed** (`class VideoAsset extends Asset`) so the base projects to a **GraphQL interface named after the class** (no `I` prefix) and each subclass to an **implementing type**, all backed by **one physical table + a discriminator column** — while the base **stays a usable ORM model** (`Asset.objects.get(id)` / `create`). No new tables, no data migration, non-breaking.

---

## 1. Why

Polymorphism is already a recurring need, and the codebase has hand-rolled **two different answers**:

- **Asset** (`apps/files`): one `files_asset` table + a `type` enum (`FILE`/`FOLDER`/`EXTERNAL_VIDEO`), exposed via **plain view-classes** + an `Asset.content()` accessor. Boilerplate; not real managers.
- **Contact** (`apps/contacts`): one `Contact` table + a `type` enum (`ContactType`) plus **separate 1:1 profile tables** (`PersonProfile`, `OrganizationProfile`). Composition, not inheritance.

Both want the same primitive: **one row-type that resolves to several GraphQL types by a discriminator, without giving up the base as a queryable model.** Build it once.

```ts
// files: one files_asset table, discriminated by `type`
class Asset extends Model { … }              // → interface Asset  (base stays a usable ORM model)
class FileAsset          extends Asset { … } // type === FILE          → type FileAsset implements Asset
class FolderAsset        extends Asset { … } // type === FOLDER        → type FolderAsset implements Asset
class ExternalVideoAsset extends Asset { … } // type === EXTERNAL_VIDEO → type ExternalVideoAsset implements Asset

// contacts: one contacts table, discriminated by `type`
class Contact      extends Model { … }       // → interface Contact
class Person       extends Contact { … }     // type === PERSON
class Organization extends Contact { … }     // type === ORGANIZATION
```
```graphql
asset(id: ID!)  { id name url  ... on ExternalVideoAsset { host embedUrl } }        # asset(id): Asset
contact(id: ID!){ id displayName ... on Organization { vatId } ... on Person { firstName } }  # : Contact
```
```ts
Asset.objects.get(id)                             // → an ExternalVideoAsset / FileAsset instance
Asset.objects.create({ type: 'EXTERNAL_VIDEO', … })  // → a video row
```

---

## 2. Principles

1. **One physical table + a discriminator — never per-type tables.** The existing table stays; it gains the subclasses' columns as **nullable** plus the discriminator (already `type`). Per-type tables would force a data migration, break single-target FKs (`Media.assetId → files_asset`), and turn "all assets" into cross-table UNIONs.

2. **The base projects to `interface <ClassName>` — no `I` prefix.** The `I` prefix in today's analyzer is a *conservative default*: for a class used both as a concrete return value **and** a supertype, it can't have two GraphQL types named `Asset`, so it emits `type Asset` + `interface IAsset`. An **STI declaration removes that ambiguity** — the base *is* the polymorphic root, so the framework projects it as `interface Asset` (the class name) and emits **no concrete `type Asset`**. See §3.

3. **GraphQL-kind and ORM-usability are decoupled.** Projecting the base as a GraphQL *interface* does **not** make it an unusable/abstract ORM model. `Asset` stays a real manager: `Asset.objects.get(id)` (materialises the concrete subclass), `Asset.objects.create({ type, … })` (creates a subclass row), `.all()`, filters. This is the whole point — you keep the base *and* get the clean interface name. (The TS `abstract` keyword is irrelevant to STI naming.)

4. **Every row resolves to a concrete implementer — never to the bare base.** GraphQL needs a concrete type per row. Two ways:
   - **Subclass every discriminator value** (`FileAsset`/`FolderAsset`/`ExternalVideoAsset`) → every row resolves cleanly, nothing left over. The tidy path.
   - **Leave some values un-subclassed** → the framework generates **one fallback implementer** with a derived name (e.g. `AssetDefault implements Asset`) for those rows. The base itself is never a concrete type.

5. **Interfaces carry fields → non-breaking.** Put today's fields on the interface (`Asset.url`, `mimeType`, `size`, …); existing `asset { url mimeType }` keeps working (implementers expose interface fields directly). Only **new** kind-specific fields (`embedUrl`, `host`) live on the subtypes, behind `... on X`. Breaking happens only if you *move* a field off the interface — a choice, not a requirement. Since all columns are on the one shared table (nullable), every subtype trivially satisfies the interface's fields.

6. **`__resolveType` and `.objects` scope by the discriminator column — not structurally.** Robust and O(1): the row's `type` value maps to the implementer; `ExternalVideoAsset.objects` auto-adds `WHERE type = 'EXTERNAL_VIDEO'`; creating one sets `type` automatically.

---

## 3. Config API

The base opts into STI and names its discriminator; each subclass declares its value.

```ts
export enum AssetType { FILE, FOLDER, EXTERNAL_VIDEO }

class Asset extends Model {
  static objects = db.manager(Asset)                 // base stays a usable manager
  static config = {
    table: 'files_asset',
    inheritance: { strategy: 'single-table', discriminator: 'type' },
  } satisfies ModelConfig<Asset>

  id = id()
  name = text()
  type = enumOf(AssetType)                            // the discriminator column
  mimeType = text({ nullable: true })                 // shared/legacy → interface fields
  size = id.Int?.({ nullable: true })                 // (illustrative) shared column
}

class ExternalVideoAsset extends Asset {
  static objects = db.manager(ExternalVideoAsset)
  static config = { discriminatorValue: AssetType.EXTERNAL_VIDEO } satisfies ModelConfig<ExternalVideoAsset>
  externalUrl = text({ nullable: true })              // subclass columns — nullable on the shared table
  host = enumOf(MediaHost, { nullable: true })
  embedUrl(): string { return derive(this.externalUrl!, this.host!) }  // computed field
}

class FileAsset   extends Asset { static config = { discriminatorValue: AssetType.FILE };   /* url() … */ }
class FolderAsset extends Asset { static config = { discriminatorValue: AssetType.FOLDER }; /* itemCount() … */ }
```

Rules:
- `inheritance.strategy: "single-table"` is **distinct from the existing `abstract: true`** (mapped superclass — columns copied, no table). STI's base **owns** the table **and** is projected as an interface.
- `discriminator` references an existing enum/string column on the base.
- Every subclass sets a unique `discriminatorValue`; the framework asserts non-overlapping values, and either warns on gaps or generates a fallback implementer (§2.4).
- Subclass columns must be nullable (a row populates only its own kind's columns).
- Optional `inheritance.interface: "SomeName"` overrides the interface name if you don't want it to match the class (rarely needed).

---

## 4. What the framework must do (layer by layer)

Extension points, from the current source:

| Layer | File(s) | Change |
|---|---|---|
| **Declare STI + merge columns** | `pylon-db/src/fields.ts`, `registry.ts` | Accept `inheritance`/`discriminatorValue`. Detect the STI group and compute the **merged column set** = base ∪ every subclass, subclass-only cols forced nullable (`registry.ts:268-285` already merges down the prototype chain — extend to union *siblings* onto one table). |
| **Base entity → interface, no `I`, no concrete type** | `pylon-db/src/ir.ts`, `pylon-ir/src/{merge.ts,sdl.ts}` | An STI base contributes an **interface entity** named after the class (not `I{Base}`) and **no** concrete object type; subclass entities carry `implements <Base>`. This overrides the analyzer's conservative `type Base` + `IBase` split for STI bases. Interface render: `sdl.ts:46-49`. |
| **One physical table, not N** | `pylon-db/src/schema-sync.ts` + migration diff/IR snapshot | Group entities by physical table; `createTable` once with the unioned columns + discriminator (`schema-sync.ts:57` emits one per def → would duplicate). The **IR snapshot must represent the merged table** so `pylon db diff` is stable (phantom-diff risk). |
| **Fallback implementer** | `pylon-db/src/ir.ts` | If not every discriminator value has a subclass, synthesise one concrete `type <Base>Default implements <Base>` so no row resolves to the bare interface. |
| **Read/write scoping + materialisation** | `pylon-db/src/manager.ts` | `Sub.objects` auto-adds `WHERE <discriminator> = <value>`; `Base.objects` spans the group **and stays usable** (`get`/`create`/`all`). On `create`, set the discriminator. On materialise, instantiate the concrete subclass (or the fallback) by discriminator value. |
| **`__resolveType` by discriminator** | `pylon/src/define-pylon.ts` (114-159), `schema-parser.ts` (496-583) | Resolve by the `type` column value → implementer name. |

Already free from the analyzer: `class Sub extends Base` → interface + `implements` (`schema-parser.ts:258-376`); `merge.ts:87-114` folds `implements` onto ORM entities (as it already does for `SearchEntity`). STI only changes the **naming/kind of the base entity** (interface, class-named, no concrete type) and adds the **table-sharing** — the rest of the interface machinery is reused.

---

## 5. Migration & DDL semantics

- **No new tables, no data migration.** Adding a subclass adds its columns as **nullable** — a cheap online `ALTER TABLE ADD COLUMN`.
- **Column union.** The physical table = base ∪ all subclass cols. No two subclasses may declare the same column name with conflicting types.
- **Discriminator is a real `NOT NULL` column** (already `type`).
- **IR-snapshot correctness is the risk.** The diff-engine snapshot must show the *merged* table, or every `diff` re-proposes the same columns. Add an STI-aware IR test.
- **Constraints/indexes** on a subclass apply to the shared table; per-kind UNIQUE → a partial index (`WHERE type = …`).

---

## 6. Query semantics

```ts
await Asset.objects.all()                              // every kind
await ExternalVideoAsset.objects.all()                // WHERE type = 'EXTERNAL_VIDEO'
await Asset.objects.create({ type: 'EXTERNAL_VIDEO', externalUrl, host })  // a video row (base manager usable)
await ExternalVideoAsset.objects.create({ externalUrl, host })             // type set automatically
const a = await Asset.objects.get({ id })             // → ExternalVideoAsset | FileAsset | … instance
a instanceof ExternalVideoAsset                        // true, per the row's discriminator
```

- **`Base.objects` stays fully usable** — read *and* write. `get`/`all`/filter materialise the concrete subclass; `create` needs the discriminator (either passed to the base manager or implied by a subclass manager).
- Relations pointing at the base (`Media.asset`) resolve to the interface; shared fields select directly, kind-specific via `... on X`.
- Filters on subclass-only columns are valid on that subclass's manager (or `... on X` in a query field).

---

## 7. Edge cases & open questions

- **Un-subclassed discriminator values** → resolve to the generated `<Base>Default` implementer (§2.4). Never to the bare interface.
- **Empty interface.** The base must expose ≥1 field or the SDL interface is invalid (`sdl.ts` already strips empty ones) — trivially true here.
- **Non-breaking check.** Keep every field currently on the flat type **on the interface** (§2.5); audit consumers before *moving* any field to a subtype.
- **`abstract: true` (mapped superclass) vs STI base** — distinct features (separate tables vs one shared). Registration must reject combining them on one base.
- **Nested inheritance** (`A extends B extends STIBase`): out of scope for v1 — one level.
- **Writes through the base manager:** `Asset.objects.create({ type, … })` is allowed (sets the discriminator, populates that kind's columns). A subclass manager is the typed shortcut.

---

## 8. Rollout

1. **`pylon-db` STI core:** config, column-union + one-table migration mapping, base-entity-as-interface (class-named, no `I`, no concrete type) + fallback implementer, discriminator scoping/materialisation, `__resolveType` by discriminator. Land behind tests (IR/DDL snapshot, migration diff, query scoping). The interface machinery itself is reused from the analyzer.
2. **Adopt in `files`:** `FileAsset`/`FolderAsset`/`ExternalVideoAsset extends Asset`. `Asset` → `interface Asset`; polymorphic access points return `Asset`; `Asset.objects.get/create` keep working; delete the view-class `content()`. Keep current fields on the interface → non-breaking.
3. **Adopt in `contacts`** (later): `Person`/`Organization extends Contact`, discriminated by the existing `ContactType`; optionally fold the profile tables into the contact table.

## 9. Non-goals

- Multi-table (per-subtype table) inheritance.
- Multi-level class hierarchies (v1 is one level).
- Union **input** types (unchanged; first-member-only in the analyzer).
- Changing how non-STI models map (one model = one type = one table stays the default; the `I`-prefix convention is unchanged for ordinary dual-use classes — STI is the opt-in that drops it).
