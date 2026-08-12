---
title: Vector Search
nav: Vector Search
description: Semantic retrieval with pgvector — declare an embedding column, index it for ANN, and query by similarity with .nearest().matches().
section: Data — pylon-db
order: 3.5
---

Pylon has first-class **dense vector retrieval** on top of
[pgvector](https://github.com/pgvector/pgvector): store embeddings in a `vector`
column, index them for approximate-nearest-neighbour (ANN) search, and query by
*similarity* — all with the same tenant scoping, filters, and migrations as any
other field. Three pieces fit together:

1. a [`vector` column](/docs/data/models#vector-embeddings) to hold the embedding,
2. an [ANN index](/docs/data/models#indexes) (`hnsw` / `ivfflat`) so search is fast,
3. the [`.nearest()`](/docs/data/queries#vector-search) query method.

Pylon owns the plumbing — the `vector` extension is created automatically, the
column type is migrated like any other, and the query composes with `.filter()` and
the tenant scope. It does **not** own the embedding model: you compute the
`number[]` (via Voyage, OpenAI, a local `bge`/`fastembed`, …) and hand it in.

## 1. Declare the column

`vector({dim})` declares a fixed-length embedding. Add `{index: true}` for a
default HNSW/cosine index:

```ts
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, vector} from '@getcronit/pylon-db'

class Doc extends Model {
  static objects = manager(Doc)

  id = id()
  title = text()
  embedding = vector({dim: 1536, index: true}) // pgvector `vector(1536)` + HNSW/cosine
}

export default new Pylon({db: {models: [Doc]}})
```

The embedding is **write-mostly**: it's excluded from the default `SELECT` (a
1536-dim vector is several KB per row), so a loaded `Doc` doesn't carry
`embedding` back — you write it and search by it, you rarely read it. See
[Vector embeddings](/docs/data/models#vector-embeddings).

## 2. Index it (tuning)

`{index: true}` is shorthand for an HNSW/cosine index with pgvector's defaults. Since
it's a single-column index, tune it **on the field** — pass an object with a
`metric`, a `method` (`hnsw`/`ivfflat`), and HNSW build parameters via `with`:

```ts
embedding = vector({
  dim: 1536,
  index: {method: 'hnsw', metric: 'cosine', with: {m: 16, ef_construction: 64}}
})
```

(Composite indexes — spanning several columns — go in
[`static config`](/docs/data/models#indexes) instead; a single-column ANN index
belongs on the field.)

| Metric | Distance | Use for |
| --- | --- | --- |
| `cosine` (default) | angle | normalized text embeddings (most models) |
| `l2` | Euclidean | raw magnitude matters |
| `ip` | inner product | dot-product-trained models |

The query metric must match the index metric, or the planner falls back to a full
scan. `method: 'ivfflat'` is available too (tune with `with: {lists: N}`; it needs
data present to build well).

## 3. Query with `.nearest()`

`.nearest(vec)` orders rows by their embedding's distance to `vec`, closest first.
It returns a narrow query with two terminals:

- `.matches()` → `{ item, score }[]` — rows **with** their similarity score
- `.all()` → the rows only

```ts
const hits = await Doc.objects
  .filter({workspaceId})              // pre-filter — tenant-scoped, ANDed before the ANN scan
  .nearest(queryEmbedding, {k: 5})    // top 5 by distance
  .matches()

for (const {item, score} of hits) {
  console.log(item.title, score)      // score: similarity, higher = closer
}
```

- **`k`** caps the result (a `LIMIT`).
- The vector column is **auto-discovered** when the model has exactly one; with
  several, pass `{column: 'embedding'}`.
- **`metric`** defaults to the column's index metric; override with
  `{metric: 'l2'}`.
- `.nearest()` **can't** be combined with [`.paginate()`](/docs/data/queries#relay-pagination)
  — distance has no seekable cursor. Raise `k` to fetch more.

Because `.nearest()` composes with `.filter()` and the tenant scope, a multi-tenant
model never leaks another tenant's vectors — the scope ANDs into a `WHERE` before the
ANN scan.

## Multiple embeddings

“Multiple” shows up three ways, and only one becomes multiple columns:

| Axis | How | Framework view |
| --- | --- | --- |
| Several source **fields** per object | concatenate into one embedding text | **one** `vector` column |
| Several **models** (e.g. `voyage-3` vs `bge`) | a `model` discriminator column + unique `(…, model)` | `.filter({model}).nearest(vec)` |
| Several `vector` **columns** on one model | separate columns | `.nearest(vec, {column})` |

The common shape is a dedicated embedding table with one `vector` column and
discriminator columns (`model`, `objectType`), queried by pre-`.filter()` — not
multiple columns.

## Hybrid search

Dense vectors miss exact tokens (a SKU, an invoice number); full-text catches those.
**Hybrid search** fuses both — and it's application code, since Pylon gives you both
ranked inputs: a `.nearest()` list and a [`.search()`](/docs/data/queries#full-text-search)
list. A robust default is Reciprocal Rank Fusion (fuse by rank position, so the two
incomparable score scales don't need normalizing):

```ts
const [dense, sparse] = await Promise.all([
  Doc.objects.filter(scope).nearest(queryEmbedding, {k: 50}).all(),
  Doc.objects.filter(scope).search(queryText, {rank: true}).all()
])
// fuse `dense` and `sparse` by rank → your final ordering
```

## Writing & re-embedding

Write embeddings like any column via `create` — or, for an idempotent re-embed loop
(insert the first time, update when the source changes), use
[`upsert`](/docs/data/queries#writes) on a unique key:

```ts
await Embedding.objects.upsert(
  {objectRef: 'doc/42', model: 'voyage-3', embedding, contentHash},
  {onConflict: ['tenantId', 'objectRef', 'model'], update: ['embedding', 'contentHash']}
)
```

`upsert` is a single atomic `INSERT … ON CONFLICT DO UPDATE`, tenant-safe — a
conflict can never touch another tenant's row. Hash the embedding source and skip the
(expensive) re-embed when the hash is unchanged.

## See also

- [Models & Fields → Vector embeddings](/docs/data/models#vector-embeddings) — the column type
- [Models & Fields → Indexes](/docs/data/models#indexes) — HNSW / ivfflat index config
- [Querying → Vector search](/docs/data/queries#vector-search) — the `.nearest()` reference
- [Querying → Writes](/docs/data/queries#writes) — `upsert` / `upsertMany`
- [Multi-Tenancy](/docs/data/multi-tenancy) — how the scope applies to vector queries
