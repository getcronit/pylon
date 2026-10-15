# pylon-db — Dense Vector Retrieval (`vector` / `.nearest()`) — Design Draft

**Status:** **F1–F5 implementiert** (Draft → gelandet) · **Scope:** pylon-db + pylon-ir framework primitives only
**Motiviert von:** [SOCKEL_pgvector.md](../sockel/SOCKEL_pgvector.md) §10 — die *dense* Retrieval-Seite.
**Nicht-Ziel:** die SOCKEL-App-Schicht (EmbeddingProvider, Embed-Text-Komposition, `resolveEach`-Semantik, Hybrid-Fusion) — bleibt bewusst außerhalb (§9 unten).

> **Implementierungsstand.** F1 (`models.Vector`), F3 (`CREATE EXTENSION vector`), F2 (HNSW/ivfflat-Index + Metrik→ops + `WITH`), F4 (`.nearest().matches()`) und F5 (natives `upsert`) sind gelandet — inkl. Write-Serialisierung (`number[]`→`'[…]'`). Getestet: pylon-ir 69/69, pylon-db 277 Unit + **12 live-e2e gegen echtes pgvector** (Extension→Spalte→HNSW-Index→`.nearest().matches()`-Ranking/Scores/Filter-Komposition; `upsert` insert/update-in-place + Tenant-Isolation). Bleibt App-seitig SOCKEL (§9). Rest-Entscheidungen: Auto-Index-Default (#4), `embed`/`sensitivity` (#5).

---

## 0. Ausgangslage (verifiziert gegen den Code, nicht gegen das SOCKEL-Doc)

Die *sparse* Seite ist real und liefert das Bauplan-Muster:

- `.search(query, {column?, language?, rank?})` — FTS über eine aus `@model({search})` synthetisierte `tsvector`-Spalte, komponiert mit `.filter()` + Tenant-Scope, `{rank}` ordnet nach `ts_rank`. → [`manager.ts:882`](packages/pylon-db/src/manager.ts:882).
- `pg_trgm` wird **ops-getrieben** installiert (ein Index mit `ops:'gin_trgm_ops'` triggert `CREATE EXTENSION`) → [`diff.ts:603`](packages/pylon-ir/src/diff.ts:603), [`schema-sync.ts:325`](packages/pylon-db/src/schema-sync.ts:325).
- Tenant/fail-closed wird zentral in `QuerySet.predicates()` injiziert ([`manager.ts:793`](packages/pylon-db/src/manager.ts:793)) — jede neue Query-Methode, die auf `state.raw` schiebt, erbt das gratis.

**Korrekturen am SOCKEL-Doc** (Grep-verifiziert, existieren nicht):

| Doc-Behauptung | Realität |
|---|---|
| „`embed`-Feldmarkierung (`FieldMeta.embed`, schon da)" | Kein `FieldMeta`. `FieldOptions` ([`fields.ts:56`](packages/pylon-db/src/fields.ts:56)) hat **kein** `embed`. |
| `sensitivity !== 'normal'` als Feld-Attribut | Existiert nirgends. |
| `ModelIndex.where` (Partial-Index) | `ModelIndex` = `{columns, unique?, method?, name?}` — kein `where`. |

⟹ `embed` / `sensitivity` sind **noch keine** Primitiven. Entscheidung dazu in §7.

---

## 1. Umfang: vier Framework-Gaps (+ ein Nice-to-have)

| # | Feature | Kern-Andockpunkt | Priorität |
|---|---|---|---|
| **F1** | `models.Vector({ dim })` → `vector(N)`-Spaltentyp | `SqlType`-Union (×2) + `fields.ts` Factory + Type-Mappings (×3) | P0 |
| **F2** | ANN-Index `method: 'hnsw'\|'ivfflat'` + ops-Klasse + `WITH`-Params | `ModelIndex`/`IndexSpec` + `dialect.indexMethod` + Auto-Index-Synthese | P0 |
| **F3** | `CREATE EXTENSION vector` (konditional, **vor** Table-DDL) | Extension-Sammelpass, ops-getriebene Sites | P0 |
| **F4** | `.nearest(vec, { column?, metric?, k?, rank? })` | `QuerySet` (spiegelt `.search()`) | P0 |
| **F5** | Natives `upsert` per Unique-Key | Manager/QuerySet Writer | P1 (Nice-to-have) |

**F1–F4 sind gekoppelt** und müssen zusammen landen (ein `vector`-Feld ohne `.nearest()` ist nutzlos; ein Index ohne Extension bricht). F5 ist unabhängig und dient `ctx.mirror` + idempotentem Re-Embed.

---

## 2. F1 — Vektor-Spaltentyp `models.Vector({ dim })`

### API
```ts
class ArtikelEmbedding extends Model {
  static config = { table: 'artikel_embedding', tenant: 'tenantId' } satisfies ModelConfig<ArtikelEmbedding>
  id        = id()
  objectRef = text()
  model     = text()                              // Provider.id, z.B. 'voyage-3'
  embedding = models.Vector({ dim: 1024 })        // → column: vector(1024) NOT NULL
}
```
`Vector` gibt TS-seitig `number[] | null` zurück (nullable analog zu allen Scalars, `.nonNull()` o. `{nullable:false}` erzwingt NOT NULL).

### Touch-Points (alle verifiziert)
1. **`SqlType`-Union — beide Kopien** (werden von Hand synchron gehalten):
   - [`registry.ts:4`](packages/pylon-db/src/registry.ts:4) → `… | 'tsvector' | 'vector'`
   - [`ir.ts:32`](packages/pylon-ir/src/ir.ts:32) → identisch.
2. **`ColumnDefinition` + `ColumnSpec` brauchen `dim?: number`** — analog zu `length?/precision?/scale?`:
   - [`registry.ts:17`](packages/pylon-db/src/registry.ts:17) (`ColumnDefinition`)
   - [`ir.ts:50`](packages/pylon-ir/src/ir.ts:50) (`ColumnSpec`)
3. **Factory** in [`fields.ts`](packages/pylon-db/src/fields.ts) (Muster von `struct()`/`uuid()`):
   ```ts
   export function vector(options: FieldOptions & { dim: number }): number[] | null {
     if (!Number.isInteger(options.dim) || options.dim < 1)
       throw new Error(`vector(): dim must be a positive integer, got ${options.dim}`)
     return field('vector', { dim: options.dim }, options) as number[] | null
   }
   ```
   Registriert unter `models.Vector` (dieselbe Stelle, wo `models.Struct = struct` exportiert wird).
4. **Type-Mappings — drei parallele Stellen** (SQL-Typ-String):
   - `postgres.columnType` [`dialect.ts:37`](packages/pylon-ir/src/dialect.ts:37) → `vector(${col.dim})`
   - `pgColumnType` [`schema-sync.ts:31`](packages/pylon-db/src/schema-sync.ts:31) (kysely-Pfad, `db push`) → `vector(${dim})`
   - `scalarForSqlType` [`ir.ts:43`](packages/pylon-db/src/ir.ts:43) → TS-Reflection `number[]`
5. **`buildColumn`** [`fields.ts:895`](packages/pylon-db/src/fields.ts:895) — `dim` vom Builder in `ColumnDefinition` durchreichen.

### Serialisierung (Runtime)
pgvector akzeptiert das Literal `'[0.1,0.2,…]'`. Beim Insert/Query muss `number[]` → `'[…]'` gehen (analog zur jsonb-Serialisierung in [`rowFromInstance`](packages/pylon-db/src/manager.ts), commit `abd9812`). Parameter-Binding: `$1::vector`. **Offen:** Reader-Seite — pgvector liefert `'[…]'` als Text zurück; Parse zu `number[]` im Row-Hydrator.

### Validierung (optional, P1)
Length-Check `vec.length === dim` beim Insert (analog `min/max`-Rules in `ColumnDefinition`) — verhindert stillen Dim-Mismatch, der sonst erst Postgres wirft.

---

## 3. F2 — ANN-Index (`hnsw`/`ivfflat` + Metrik)

### API — explizit (empfohlen, wegen Tuning)
```ts
static config = {
  indexes: [{
    columns: ['embedding'],
    method:  'hnsw',                      // NEU
    metric:  'cosine',                    // NEU → ops-Klasse
    with:    { m: 16, ef_construction: 64 }   // NEU → WITH (...)
  }]
} satisfies ModelConfig<…>
```

### API — Field-Level (Single-Column) + Zero-Config-Shorthand
Ein `vector`-Feld mit `{ index: true }` synthetisiert einen HNSW/cosine-Index (btree geht auf `vector` nicht) — analog zur `tsvector`→Auto-GIN-Synthese ([`ir.ts`](packages/pylon-db/src/ir.ts)). Getunt wird **am Feld** (Single-Column gehört ans Feld, Composite in die Config):
```ts
embedding = vector({ dim: 1536, index: { method: 'hnsw', metric: 'l2', with: { m: 32 } } })
```
`FieldOptions.index` ist `boolean | SingleColumnIndex` (`{method?, metric?, with?}`); `buildColumn` normalisiert → `ColumnDefinition.index` (Flag) + `indexOptions`; `entityFromDefinition`s `singleColumn`-Zweig löst Methode/Metrik/Params auf (Default `hnsw`/`cosine` für vector, sonst btree). Eine ANN-Methode auf einer Nicht-Vektor-Spalte wirft schon in `buildColumn` (Authoring-Zeit). Die `config.indexes` (§F2) bleiben für **Composite**.

### Metrik → Operator + ops-Klasse (die zentrale Tabelle)
| `metric` | ANN-`ORDER BY`-Op | ops-Klasse | Score (`rank:true`) |
|---|---|---|---|
| `cosine` (default) | `<=>` | `vector_cosine_ops` | `1 - distance` |
| `l2` | `<->` | `vector_l2_ops` | `-distance` |
| `ip` (inner product) | `<#>` | `vector_ip_ops` | `-(<#>)` |

**Invariante:** Index-Metrik **muss** Query-Metrik matchen, sonst nutzt der Planner den ANN-Index nicht (Seq-Scan-Fallback). → Die Metrik wird auf der `vector`-Spalte gemerkt (aus ihrem Index abgeleitet) und ist der Default für `.nearest()` (§5). Mismatch = Warn/Throw.

### Touch-Points
1. **`ModelIndex` erweitern** [`registry.ts:152`](packages/pylon-db/src/registry.ts:152):
   ```ts
   method?: 'gin' | 'btree' | 'hnsw' | 'ivfflat'
   metric?: 'cosine' | 'l2' | 'ip'          // NEU — mappt auf ops-Klasse
   with?:   Record<string, number>          // NEU — WITH (m=…, ef_construction=…)
   ```
2. **`IndexSpec` erweitern** [`ir.ts:116`](packages/pylon-ir/src/ir.ts:116) — hat schon `ops?`; ergänze `with?`. Metrik wird beim Bridging (`entityFromDefinition`) zu `ops` aufgelöst.
3. **`postgres.indexMethod`** [`dialect.ts:50`](packages/pylon-ir/src/dialect.ts:50) — gibt bereits `USING <method>` für non-btree zurück ⟹ `hnsw`/`ivfflat` funktionieren **ohne Änderung**.
4. **Spalten-Rendering mit ops-Klasse** — der ANN-Index braucht die ops-Klasse *pro Spalte* im Klammerausdruck: `USING hnsw (embedding vector_cosine_ops)`. Der Trigram-Pfad macht das schon ([`schema-sync.ts:329`](packages/pylon-db/src/schema-sync.ts:329), [`ir.ts:236`](packages/pylon-db/src/ir.ts:236) setzt `ops:'gin_trgm_ops'`). ⟹ dieselbe Column+ops-Renderung wiederverwenden.
5. **`WITH`-Klausel** — **neu**, existiert nirgends. In `addIndexSQL` [`diff.ts:601`](packages/pylon-ir/src/diff.ts:601) und im `db push`-Pfad [`schema-sync.ts:329`](packages/pylon-db/src/schema-sync.ts:329) ein `WITH (${entries})`-Suffix anhängen wenn `ix.with`.
6. **`indexEqual`** [`diff.ts:146`](packages/pylon-ir/src/diff.ts:146) — muss jetzt auch `metric`/`ops`/`with` vergleichen, sonst wird ein Metrik-Wechsel nicht als Diff erkannt (falsch-grüne Migration).
7. **Auto-Synthese** [`ir.ts:219`](packages/pylon-db/src/ir.ts:219) — Zweig „für jede `vector`-Spalte einen HNSW-Index" neben dem bestehenden `tsvector`→GIN-Zweig.

---

## 4. F3 — `CREATE EXTENSION vector` (die kritische Ordering-Abweichung)

**Wichtiger Unterschied zu `pg_trgm`:** `pg_trgm` braucht die Extension nur für den *Index*. `vector` braucht sie schon für den *Spaltentyp* `vector(N)` — also **bevor** die `CREATE TABLE` läuft. Ops-getriebene Extension-Erzeugung (die pg_trgm nutzt) reicht daher **nicht**: sie feuert bei Index-Erzeugung, zu spät für die Tabelle.

### Design
Ein **Extension-Sammelpass**, der *vor* jeder Table-DDL läuft:
- Trigger = „irgendein Modell hat eine `vector`-Spalte" (nicht der Index).
- Emittiert `CREATE EXTENSION IF NOT EXISTS vector` als allererste Statement-Gruppe.

### Touch-Points
- **`db push`** [`schema-sync.ts:301`](packages/pylon-db/src/schema-sync.ts:301) (`syncSchema`) — Extensions aus allen Modell-Spalten sammeln, vor der Tabellen-Sync-Schleife ausführen. Der `ops`-getriebene `pg_trgm`-Block [`:325`](packages/pylon-db/src/schema-sync.ts:325) bleibt für Index-Extensions; `vector` kommt in den neuen Vorab-Pass.
- **Migrationen** [`diff.ts`](packages/pylon-ir/src/diff.ts) — `CREATE EXTENSION vector` als eigene `SchemaChange` (oder in den bestehenden Extension-Sammelmechanismus), garantiert vor `createTable`-Changes einsortiert. **Down-Migration:** `DROP EXTENSION` bewusst **nicht** (andere Objekte könnten sie brauchen) — nur no-op oder `IF EXISTS … RESTRICT`.

---

## 5. F4 — `.nearest()` (das Herzstück, spiegelt `.search()`)

### API
```ts
// Nur die Objekte — T bleibt sauber getippt:
ArtikelEmbedding.objects
  .filter({ model: 'voyage-3' })               // Pre-Filter (WHERE) — HNSW Post-Filter
  .nearest(queryVec, { k: 5 })                 // ORDER BY embedding <=> $q LIMIT 5
  .all()                                        // → T[]  (Score verworfen)

// Mit Score — eigenes Terminal, Envelope statt T-Pollution:
ArtikelEmbedding.objects
  .filter({ model: 'voyage-3' })
  .nearest(queryVec, { k: 5 })
  .matches()                                    // → { item: T; score: number }[]
// tenant-Scope + Policy sind automatisch AND-verknüpft (predicates())
```

Signatur — `.nearest()` verengt den Rückgabetyp auf `NearestQuerySet<T>` (⊃ `QuerySet<T>`), der zusätzlich das `.matches()`-Terminal trägt:
```ts
interface NearestOptions {
  column?: string                       // default: die einzige vector-Spalte (throw bei Mehrdeutigkeit)
  metric?: 'cosine' | 'l2' | 'ip'       // default: die Index-Metrik der Spalte
  k?: number                            // → .limit(k); default z.B. 10
}
interface Match<T> { item: T; score: number }

nearest(vec: number[], options?: NearestOptions): NearestQuerySet<T>

// NearestQuerySet<T> ist ein SCHMALES Interface (kein QuerySet-Subtyp) — es
// exponiert NUR die kNN-sinnvollen Terminals; .paginate()/.filter()/Writer sind
// gar nicht am Typ:
interface NearestQuerySet<T> {
  matches(): Promise<Match<T>[]>   // Envelope mit Score
  all():     Promise<T[]>          // Reihen distanz-sortiert, Score verworfen
  first():   Promise<T | null>     // die eine nächste Reihe
}
```

> **Verfeinert gegenüber dem ursprünglichen Entwurf:** `NearestQuerySet` war als `QuerySet<T>`-**Subklasse** geplant — die hätte `.paginate()` (u.a.) geerbt und zur Laufzeit werfen müssen (lügender Typ). Stattdessen ist es ein **schmales Interface**: der Laufzeit-Wert ist intern eine `QuerySet`-Subklasse (`NearestQuerySetImpl`, für `build()`-Reuse), aber `.nearest()` gibt sie als das schmale Interface zurück. `.paginate()` ist damit **gar nicht am Typ** — kein Laufzeit-Throw als Primärmechanismus nötig (der bestehende Guard bleibt nur als Defense-in-Depth).

### Warum ein Terminal-Envelope, nicht ein `score`-Flag (und nicht `.withScore()`/`rank`)
Der Kern: **der Score gehört nicht zur Entität.** `Artikel` hat keinen Score — der *Match* hat einen. Ein Flag `{score:true}` klebte `_score` auf die Row (`T & {_score}`) und vermischte Entitätsdaten mit Query-Metadaten. `.matches()` legt den Score auf einen **Envelope**, geschwister zum Item — genau wie `.paginate()` `Connection<T>` liefert statt `T[]` ([`manager.ts:1196`](packages/pylon-db/src/manager.ts:1196)). Drei Konsequenzen:

- **Kein `T`-Pollution.** `.all()` gibt weiter reines `T[]`; den Envelope zahlt man nur bei `.matches()`.
- **Kein Orphan-Problem — durch Typen erzwungen.** `.matches()` sitzt auf `NearestQuerySet<T>`, den *nur* `.nearest()` produziert. `Model.objects.filter(...).matches()` existiert typseitig nicht. Das ist der Grund, warum eine freie `.withScore()`-Methode auf dem Basis-`QuerySet` verworfen wurde (dort wäre sie ohne `.nearest()` bedeutungslos und müsste werfen).
- **Shape-Entscheidung am Terminal**, wo man konsumiert — nicht als Flag in den `.nearest()`-Optionen vergraben. Kein Overload-Gymnastik.

Ein `rank`-Flag (wie `.search()`) wäre ohnehin doppelt falsch: `.search({rank})` toggelt **Sortierung** (die dort abschaltbar ist — `.count()`/`.exists()`, Sortierung nach `created_at`, Bulk-`.update()`, Keyset). Bei `.nearest()` **ist** die Distanz-Sortierung die Operation selbst und nicht abschaltbar; die einzige togglebare Achse ist die Score-*Projektion* — und die löst `.matches()` als Terminal sauberer als jedes Flag.

**Wann man den Score *nicht* will:** eine UI-Liste „5 ähnlichste Artikel" → `.all()`, die Reihenfolge trägt schon alles. **SOCKEL will ihn immer** (`resolveEach`: Schwelle `minScore`, `candidates`, Provenance — §5) → `.matches()`.

### Warum die Signatur von der Doc (`nearest(field, vec, …)`) abweicht
`.search()` auto-entdeckt die Spalte via `def.columns.find(c => c.sqlType === 'tsvector')`. Für Vektoren ist Multi-Spalte realistisch (§5.1 unten) ⟹ Auto-Discovery nur wenn **genau eine** `vector`-Spalte existiert, sonst `column` verpflichtend (klarer Throw). Konsistenter mit `.search()`s Options-Objekt als die positionale `field`-Form.

### Implementierung (Kontrast zu `.search()`)
`.search()` schiebt ein **WHERE-Prädikat** (`@@`) auf `state.raw` **und** setzt `state.rank` fürs `ORDER BY ts_rank`. `.nearest()` ist reines **ORDER BY + LIMIT** (kein WHERE-Prädikat):

1. **Neuer `QueryState.nearest`** [`manager.ts:748`](packages/pylon-db/src/manager.ts:748): `{ ref, vec, metric }`.
2. **`build()`** [`manager.ts:908`](packages/pylon-db/src/manager.ts:908) — Zweig neben `state.rank`:
   ```ts
   if (this.state.nearest) {
     const { ref, vec, metric } = this.state.nearest
     const op = { cosine: sql`<=>`, l2: sql`<->`, ip: sql`<#>` }[metric]
     q = q.orderBy(sql`${sql.ref(ref)} ${op} ${vecLiteral(vec)}`, 'asc')  // Distanz ASC
     if (this.state.withMatches)                                          // nur für .matches()
       q = q.select(sql`1 - (${sql.ref(ref)} ${op} ${vecLiteral(vec)})`.as('__score'))  // metrik-abhängig, Tabelle §3
   }
   ```
3. **`k` → `.limit(k)`** (bestehende Limit-Mechanik).
4. **`.matches()`-Terminal** — setzt `state.withMatches`, führt `build()` aus, mappt jede Row zu `{ item: hydrate(row), score: row.__score }` und **strippt** `__score` vom hydratisierten Item (bleibt sauberes `T`). `.all()` setzt das Flag nicht → keine Score-Spalte im SQL.
5. **`selectableColumns`** [`manager.ts:1638`](packages/pylon-db/src/manager.ts:1638) — Vektor-Spalten aus dem Default-SELECT ausschließen (`… || c.sqlType === 'vector'`), damit weder `.all()` noch `.matches().item` das Embedding zurückholen (§5.2).
6. **Tenant/Policy** — gratis: `predicates()`/`applyWhere` laufen unverändert, ANDen den `WHERE tenant_id=$t` **vor** den ANN-Scan (= HNSW-Post-Filter, wie SOCKEL §3).

Die Score-Projektion (`__score`, nur beim `.matches()`-Pfad) ist die **eine neue Fähigkeit** über `.search()` hinaus (dessen `{rank}` nur ordnet, nie projiziert). Metrik-abhängige Score-Formel: cosine `1-dist`, l2 `-dist`, ip `-(<#>)` (Tabelle §3). Das `__score` ist ein interner Alias — es taucht **nie** auf `T` auf, nur im `Match<T>.score`.

### Constraints
- **Keyset-Pagination inkompatibel** — Distanz hat keinen seekbaren Cursor (wie `state.rank`). Deshalb ist `.paginate()` **gar nicht** am `NearestQuerySet`-Interface (nicht bloß ein Laufzeit-Throw). Für „mehr laden" `k` erhöhen.
- **Metrik-Konsistenz** — default = Spalten-Index-Metrik (aus einem ANN-Index auf der Spalte), sonst `cosine`; abweichende `metric` ⟹ ANN-Index wird nicht genutzt (Seq-Scan-Fallback).

### 5.1 Mehrere Embeds — zwei Patterns
„Mehrere" hat drei Achsen, die **nicht** alle zu Multi-Spalte werden:

| Achse | Lösung | Framework-Sicht |
|---|---|---|
| Mehrere `embed`-**Felder** pro Objekt (`bezeichnung`+`beschreibung`) | zu *einem* Embed-Text konkateniert (SOCKEL §1) | **eine** `vector`-Spalte |
| Mehrere **Modelle** (`voyage-3` vs `bge-m3`) | `model`-Diskriminator-Spalte, `UNIQUE (tenant, ref, model)` | `.filter({model}).nearest(vec)` |
| Mehrere Vektor-**Spalten** am selben Modell (Inline) | separate Spalten | explizit `.nearest(vec, {column})` |

Daraus zwei tragfähige Patterns:

- **Zentrale Embedding-Tabelle** (SOCKELs Wahl): *eine* `vector`-Spalte, „mehrere" via Diskriminator-Spalten (`model`, `object_type`) + Pre-`.filter()`. Auto-Discovery greift.
- **Inline-Vektoren** am Domänenmodell: mehrere `vector`-Spalten → `column` verpflichtend.

⟹ Deshalb ist die `.filter()`-Komposition (Punkt 4) der Kern: SOCKELs „mehrere Embeds" ist **Zeilen-Diskriminierung + Pre-Filter**, nicht Multi-Spalte.

### 5.2 Was `.matches()` zurückgibt — Vektor wird nie projiziert
`Match<T>.item` = das **volle hydratisierte Modell *ohne* die Vektor-Spalte**. Nicht ids-only, nicht das Embedding:

- **Nicht ids-only** — SOCKELs `candidates`-Dropdown (der `correct`-Flow, §5) braucht `objectRef` + Anzeigefelder; ids-only erzwingt N+1-Nachladen. Die Zeile wurde beim ANN-Scan ohnehin gelesen → die billigen Scalar-Spalten mitzugeben ist gratis.
- **Nicht das Embedding** — 4–8 KB/Row über die Wire; landete in SOCKEL sonst in der GraphQL-Antwort. Der Vergleich passiert *in der DB*; das rohe Embedding will client-seitig praktisch nie jemand.
- **Vektor nur im `ORDER BY`, nie im `SELECT`** — `ORDER BY col` verlangt kein `SELECT col`. Kein Wire-Cost.

**Mechanismus (Präzedenz schon da):** `selectableColumns` [`manager.ts:1636`](packages/pylon-db/src/manager.ts:1636) schließt heute die synthetisierte `tsvector`-Spalte aus dem Default-SELECT aus — mit exakt der Ratio, die auf Vektoren zutrifft („large, hidden from the API, write-only by the DB, and never read as an instance value … fetching them just wastes wire + CPU"). Der Filter ist aktuell `c.generatedAs && c.hidden`; ein user-deklarierter `vector` ist nicht `generatedAs`, fällt also nicht drunter. Fix = Prädikat um den Typ erweitern:
```ts
// manager.ts:1638
def.columns.filter(c => !((c.generatedAs && c.hidden) || c.sqlType === 'vector'))
```
`.all()` **und** `.matches().item` erben das automatisch — gleiches Item-Shape, `.matches()` trägt nur zusätzlich `score`.

**Feinheit (bewusste Grenze):** weil `embedding = models.Vector(...)` als Property deklariert ist, bleibt `number[]` Teil von `T`; per Default nicht selektiert ⟹ `instance.embedding` ist zur Laufzeit `undefined` (dieselbe Lücke wie bei jeder ausgeschlossenen Spalte). Für den seltenen Roh-Vektor-Read (Debug/Export/client-seitiges Re-Rank) ein Opt-in-Escape-Hatch — `.nearest(...).matches({ includeVector: true })` bzw. `.withVector()`. Nicht v1-kritisch.

### Nice-to-have: Filter-Operator-Form
Analog zum `tsvector`-`{search}`-Operator in `compileField` [`manager.ts:333`](packages/pylon-db/src/manager.ts:333): ein `vector`-Feld mit `{ near: vec }` im `.filter()`-DSL. Niedrigere Prio — die Methodenform deckt SOCKEL ab.

---

## 6. F5 — Natives `upsert` (implementiert)

SOCKEL braucht idempotenten Re-Embed über `UNIQUE (tenant_id, object_ref, model)` (§3) und `ctx.mirror`. Gelandet als nativer `INSERT … ON CONFLICT DO UPDATE`:
```ts
Emb.objects.upsert(values, {
  onConflict: ['tenantId', 'objectRef', 'model'],   // Property-Keys eines UNIQUE-Index
  update:     ['contentHash', 'embedding']          // Default: alle Spalten außer Konflikt-Ziel + PK
})
// → INSERT … VALUES … ON CONFLICT (…) DO UPDATE SET contentHash = excluded.contentHash, …
Emb.objects.upsertMany([...], opts)                 // Bulk: ein Statement für alle Reihen
```

**Design** ([`manager.ts` `upsertMany`](packages/pylon-db/src/manager.ts)):
- **Tenant-sicher** — der gebundene Tenant wird beim Insert gestempelt (`applyCreateDefaults`), und ein `WHERE <table>.<tenant> = $bound`-Guard am DO UPDATE verhindert, dass ein Konflikt eine *fremde* Tenant-Zeile überschreibt (load-bearing, falls das Konflikt-Ziel den Tenant nicht selbst enthält; redundant, wenn doch — wie in SOCKELs `UNIQUE (tenant, ref, model)`).
- **Gleiche Write-Pfade wie `create`** — Validierung + Serialisierung (inkl. jsonb **und** vector) via `rowFromInstance`/`dbValueForColumn`.
- **Korrekte Signale** — `(xmax = 0)` in `RETURNING` unterscheidet pro Reihe Insert vs. Update, sodass `postSave` `created` akkurat meldet.
- **Robustes Return-Mapping** — Reihen werden per Konflikt-Key zurückgematcht (nicht positional), damit ein vom Tenant-Guard verworfener Cross-Tenant-No-op die Zuordnung nicht verschiebt.

Verifiziert: [test/integration/upsert.test.ts](packages/pylon-db/test/integration/upsert.test.ts) — 5 live-e2e (Insert→Update-in-place, Default-Update-Set, `upsertMany` gemischt, und der **SOCKEL-Re-Embed-Loop mit Tenant-Isolation**: t2-Upsert überschreibt t1 nicht).

---

## 7. Entscheidung: `embed` / `sensitivity` — Framework oder SOCKEL?

Existieren heute **nicht** (§0). Das SOCKEL-Doc positioniert die *Embed-Text-Komposition* als App — aber der **Marker** muss am Feld in der Ontologie hängen. Optionen:

- **A) Explizite FieldOptions** `embed?: boolean` + `sensitivity?: 'normal'|'restricted'|…` in [`fields.ts:56`](packages/pylon-db/src/fields.ts:56). Framework **speichert** sie nur (opaker Passthrough auf `ColumnDefinition`), **handelt nicht** darauf. SOCKEL liest sie. → Deklaration bleibt in der Ontologie (Doc-Intent), minimaler Eingriff.
- **B) Generischer `meta?: Record<string,unknown>`-Passthrough** auf FieldOptions. SOCKEL liest `meta.embed`/`meta.sensitivity`. Flexibler, weniger framework-spezifisch, aber untypisiert.
- **C) Rein SOCKEL-seitig** (Side-Registry im App-Code). Kein Framework-Change, aber Deklaration wandert aus der Ontologie raus.

**Empfehlung: A** — zwei getippte, folgenlose FieldOptions. Hält die Deklaration deklarativ und in der Ontologie, ohne dass pylon-db Embedding-Semantik kennt. `sensitivity` ist ohnehin breiter nützlich (die im Doc erwähnte Rechte-Durchsetzung).

---

## 8. Rollout — abgebildet auf SOCKEL §7 (jede Stufe grün testbar)

| SOCKEL-Stufe | Braucht Framework? | Features |
|---|---|---|
| 1. `pg_trgm`-only | **Nein** — heute baubar | `.search()` + Trigram existieren |
| 2. pgvector dazu (dense) | **Ja** | **F1 + F3** (Spalte + Extension), **F2** (Index), **F4** (`.nearest`) |
| 3. Hybrid (dense+sparse) | Nein (Framework) | Fusion = SOCKEL; Zutaten (`ts_rank` + Distanz-Score) kommen aus `.search()`/`.nearest()` |
| 4. Async Embed-Job | Nein | BullMQ/Queue = SOCKEL/App |

**Interne PR-Sequenz für Stufe 2** (jede für sich grün):
1. **F1** — `vector`-Typ end-to-end (Union ×2, Factory, 3 Mappings, `db push` + Migration + Round-Trip-Harness-Test). Kein Query noch.
2. **F3** — Extension-Vorab-Pass (Ordering-Test: Extension vor `CREATE TABLE`).
3. **F2** — Index-Method + Metrik + `WITH` + Auto-Synthese + `indexEqual`-Diff-Test.
4. **F4** — `.nearest()` + `.matches()`-Terminal + Tenant-Komposition-Test + Paginate-Throw-Test.

Jede Stufe hängt am **Migration-Round-Trip-Fuzz-Harness** (generate→apply→rollback→re-apply) — der Regressionsnetz-Moat.

---

## 9. Bewusst SOCKEL (NICHT Framework)

- `EmbeddingProvider` (voyage/bge hinter Interface, wie `ModelProvider`).
- Embed-Text-Komposition (`embed`-Felder konkatenieren, `content_hash`).
- `resolveEach`-Semantik (Schwelle `minScore`, `candidates`, `prüfpflichtig`, Provenance) — konsumiert `.matches()` direkt:
  ```ts
  const matches = await Embedding.objects.filter({ model }).nearest(vec, { k: 5 }).matches()
  const top = matches[0]
  return top && top.score >= minScore(type)
    ? { resolved: refOf(top.item), score: top.score, candidates: matches }
    : { unresolved: 'below-threshold', candidates: matches }
  ```
- **Hybrid-Fusion** (§9.1) und **Reranking** (§9.2) — beides App-Ebene.
- Feedback-Loop / `decision`-Objekte (§8 SOCKEL).

Der Framework-Beitrag ist präzise: **ein Spaltentyp, ein Index-Method, eine Extension, eine Query-Methode** — sodass die dense-Seite dasselbe Auto-Scoping / fail-closed erbt wie `.search()`, statt auf rohes SQL auszuweichen (das genau die Grounding-/Tenant-Zusage brechen würde).

### 9.1 Hybrid-Suche — Fusion bleibt App (RRF als v1)
Dense (`.nearest`, Cosinus) fängt Semantik, sparse (`.search`, FTS/Trigram) fängt exakte Tokens (SKU „HEL-20L"). Das Framework liefert die zwei geordneten Listen, das **Mischen ist SOCKEL**. Robustester v1-Default ist **Reciprocal Rank Fusion** — sie braucht nur die *Position*, nicht den Score (Cosinus 0–1 und `ts_rank` sind unvergleichbar skaliert):

```ts
// SOCKEL-App-Ebene — beide Listen kommen aus pylon-db, tenant-gescopet
async function hybridResolve(text: string, vec: number[], tenant: Filter) {
  const K = 60  // RRF-Dämpfung (Standard)
  const [dense, sparse] = await Promise.all([
    Embedding.objects.filter(tenant).nearest(vec, { k: 50 }).all(),    // semantisch
    Artikel.objects.filter(tenant).search(text, { rank: true }).all()  // FTS + Trigram
  ])
  const score = new Map<string, number>()
  const fuse = (list: { ref: string }[], w: number) =>
    list.forEach((row, i) => score.set(row.ref, (score.get(row.ref) ?? 0) + w / (K + i + 1)))
  fuse(dense, 1.0)   // w_dense
  fuse(sparse, 0.8)  // w_sparse
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
}
```
Bei „HEL-20L" steht der exakte Treffer in `sparse` auf Rang 1 → dominiert; bei „Torbogen bedruckt" gewinnt `dense`. **RRF braucht den Score nicht** (nur Ränge) — deshalb der bessere v1-Default; hier reicht `.all()`. Die gewichtete Summe (`w_d·cosine + w_s·trigram`, SOCKEL §6) braucht echte Scores → dann `.nearest(vec).matches()` (FTS-Score-Projektion wäre ein separates `.search()`-Feature).

### 9.2 Reranking — zweite Stufe, ganz App-seitig
Retrieval (dense/hybrid) ist ein **Bi-Encoder**: Query und Dokument getrennt eingebettet, verglichen wird nur der Vektor-Abstand (billig, indexierbar, grob). Ein **Reranker** ist ein **Cross-Encoder**: er sieht `(Query, Kandidat)` als Paar mit voller Cross-Attention → präziser, aber zu teuer für den ganzen Index. Daher als **zweite Stufe** über die top-N des Retrievals:

```
Retrieval (ANN, top-50) ──▶ Reranker (Cross-Encoder) ──▶ top-5
   billig, breit                präzise, schmal
```

**Muss NICHT ins Framework** — dieselbe Grenze wie beim Embedding. Ein Reranker ist (1) ein Modell-Call hinter einem Interface (wie `EmbeddingProvider`), (2) eine In-Memory-Umsortierung bereits geholter Kandidaten — kein SQL, kein Index, kein Tenant-Scope:
```ts
interface RerankProvider {          // SOCKEL, analog EmbeddingProvider/ModelProvider
  readonly id: string               // 'voyage-rerank-2' | 'cohere-rerank-3'
  rerank(query: string, docs: string[]): Promise<{ index: number; score: number }[]>
}
```
Das Framework endet beim **Retrieval** (Kandidaten mit Distanz-Score, tenant-gescopet); Reranking sitzt *danach* zwischen `.nearest()` und `resolveEach`s Schwellen-Logik (`nearest` → `rerank` top-N → `minScore`/`candidates`). Optional — für einen sauberen Katalog reicht dense+hybrid oft.

---

## 10. Offene Entscheidungen

1. ~~**Score-Projektion** — Flag vs. Methode vs. Envelope.~~ **Entschieden + gebaut (§5):** `.nearest()` → schmales `NearestQuerySet<T>`-Interface (`matches`/`all`/`first`) → `Match<T>[]` (`{item, score}`). Score auf dem Envelope, nicht auf `T`; kein Orphan (typ-erzwungen); `.paginate()`/`.filter()`/Writer sind **gar nicht am Typ** (kein lügender Subtyp). Präzedenz: `.paginate()`→`Connection<T>`.
2. ~~**Was `.matches()` zurückgibt** — ids-only / Item / mit Vektor.~~ **Entschieden (§5.2):** volles Item **ohne** Vektor (`selectableColumns` um `sqlType==='vector'` erweitern); Vektor nur im `ORDER BY`. Offen nur noch: der Escape-Hatch-Name für den Roh-Vektor-Read (`.matches({includeVector})` vs. `.withVector()`) — nicht v1-kritisch.
3. **Reader-Hydration** — `vector`-Text `'[…]'` → `number[]` parsen; wo im Row-Hydrator (nur relevant, wenn der Vektor via Escape-Hatch doch selektiert wird).
4. **Auto-Index default an/aus** — HNSW ist teuer zu bauen; Zero-Config-Default (Parität zu tsvector) vs. explizit-erforderlich. Vorschlag: Default **an**, opt-out via `{index:false}`.
5. **`embed`/`sensitivity`** — §7 Option A vs. B.
6. **Multi-Metrik pro Spalte** — mehrere ANN-Indizes (cosine + l2) auf einer Spalte? Selten; vorerst 1 Metrik/Spalte.
7. **ivfflat-`lists`-Param** — via `with:{lists}` abgedeckt; braucht `ANALYZE`-Hinweis in Doku (ivfflat baut erst nach Daten sinnvoll).
8. ~~**F5-`upsert`** — jetzt mitnehmen oder separater PR.~~ **Gebaut (§6):** nativer `ON CONFLICT DO UPDATE`, tenant-sicher, `upsert`/`upsertMany`, live-e2e verifiziert.
