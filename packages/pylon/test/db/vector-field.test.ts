import {toDDL, tableSpecOf} from '@getcronit/pylon/ir'
import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {models, type ModelConfig} from '@/db/index'
import {toIR} from '@/db/ir'
import {selectableColumns} from '@/db/manager'
import {getModelDefinitionOrThrow} from '@/db/registry'

const {Model, ID, Text, Vector} = models

// A SOCKEL-style central embedding table: one `vector` column alongside plain
// discriminator/ref columns (the row-per-(object,model) shape). Table name is
// derived from the class (`artikel_embedding`); no static config needed.
class ArtikelEmbedding extends Model {
  id = ID()
  objectRef = Text()
  model = Text()
  embedding = Vector({dim: 1024})
}

// `{index: true}` on a vector column → a default HNSW/cosine ANN index (F2).
class InlineVec extends Model {
  id = ID()
  embedding = Vector({dim: 8, index: true})
}

// Explicit ANN index with a distance metric + storage params (F2), via config.
class ConfiguredVec extends Model {
  static config = {
    indexes: [{columns: ['embedding'], method: 'hnsw', metric: 'l2', with: {m: 32, ef_construction: 100}}]
  } satisfies ModelConfig<ConfiguredVec>
  id = ID()
  embedding = Vector({dim: 8})
}

// Same tuning, but declared inline on the FIELD (single-column → field-level options).
class InlineTunedVec extends Model {
  id = ID()
  embedding = Vector({dim: 8, index: {method: 'hnsw', metric: 'l2', with: {m: 32, ef_construction: 100}}})
}

// No vector column → `.nearest()` has nothing to target.
class Plain extends Model {
  id = ID()
  name = Text()
}

// Two vector columns → `.nearest()` is ambiguous without `{column}`.
class TwoVec extends Model {
  id = ID()
  a = Vector({dim: 2})
  b = Vector({dim: 2})
}

new Pylon({db: {models: [ArtikelEmbedding, InlineVec, ConfiguredVec, InlineTunedVec, Plain, TwoVec]}})

// Compile-time gating (validated by `tsc`, never executed): `.matches()` exists
// only on the NearestQuerySet that `.nearest()` returns — not on a plain query.
;() => {
  // @ts-expect-error — .matches() requires a preceding .nearest()
  ArtikelEmbedding.objects.filter({}).matches()
  ArtikelEmbedding.objects.nearest([1, 2, 3]).matches() // ok
  ArtikelEmbedding.objects.nearest([1, 2, 3]).all() // ok — nearest also exposes .all()/.first()
  // @ts-expect-error — .paginate() is NOT offered after .nearest() (no seekable cursor)
  ArtikelEmbedding.objects.nearest([1, 2, 3]).paginate()
  // @ts-expect-error — .filter() is not offered after .nearest() (pre-filter instead)
  ArtikelEmbedding.objects.nearest([1, 2, 3]).filter({})
}

describe('F1 — models.Vector → vector(dim) column', () => {
  const entity = toIR().entities.ArtikelEmbedding

  it('emits a `vector` ColumnSpec carrying dim + requires:postgres', () => {
    const col = entity.fields.find(f => f.name === 'embedding')!.column!
    expect(col).toMatchObject({
      name: 'embedding',
      sqlType: 'vector',
      dim: 1024,
      requires: 'postgres'
    })
  })

  it('renders `vector(1024)` in the CREATE TABLE DDL', () => {
    const ddl = toDDL(tableSpecOf(entity))
    expect(ddl).toMatch(/CREATE TABLE "artikel_embedding"/)
    expect(ddl).toMatch(/"embedding" vector\(1024\)/)
    // plain columns still render normally alongside it
    expect(ddl).toMatch(/"object_ref" text/)
  })

  it('rejects a non-positive / non-integer dim at authoring time', () => {
    expect(() => Vector({dim: 0})).toThrow(/positive integer/)
    expect(() => Vector({dim: -4})).toThrow(/positive integer/)
    expect(() => Vector({dim: 1.5})).toThrow(/positive integer/)
  })

  it('{index:true} on a vector → a default HNSW/cosine ANN index (not btree)', () => {
    const ix = toIR().entities.InlineVec.indexes!.find(i => i.columns.includes('embedding'))!
    expect(ix).toMatchObject({method: 'hnsw', ops: 'vector_cosine_ops', columns: ['embedding']})
  })

  it('explicit indexes config resolves metric→operator-class and carries WITH params', () => {
    const ix = toIR().entities.ConfiguredVec.indexes!.find(i => i.columns.includes('embedding'))!
    expect(ix).toMatchObject({
      method: 'hnsw',
      ops: 'vector_l2_ops',
      with: {m: 32, ef_construction: 100}
    })
  })

  it('field-level {index: {...}} tunes the single-column index (same as config)', () => {
    const ix = toIR().entities.InlineTunedVec.indexes!.find(i => i.columns.includes('embedding'))!
    expect(ix).toMatchObject({
      method: 'hnsw',
      ops: 'vector_l2_ops',
      with: {m: 32, ef_construction: 100}
    })
  })

  it('an ANN method on a non-vector column is rejected at build time', () => {
    class BadIdx extends Model {
      id = ID()
      name = Text({index: {method: 'hnsw'}})
    }
    expect(() => new Pylon({db: {models: [BadIdx]}})).toThrow(/only valid on a vector column/)
  })

  it('excludes the vector column from the default SELECT (write-mostly)', () => {
    const cols = selectableColumns(getModelDefinitionOrThrow(ArtikelEmbedding))
    expect(cols).toContain('object_ref')
    expect(cols).toContain('model')
    expect(cols).not.toContain('embedding') // §5.2 — never fetched by .all()/.matches()
  })

  it('.nearest() throws when the model has no vector column', () => {
    expect(() => Plain.objects.nearest([1, 2])).toThrow(/needs a vector column/)
  })

  it('.nearest() throws when the vector column is ambiguous (pass {column})', () => {
    expect(() => TwoVec.objects.nearest([1, 2])).toThrow(/multiple vector columns/)
    // …and resolves when disambiguated.
    expect(() => TwoVec.objects.nearest([1, 2], {column: 'a'})).not.toThrow()
  })

  it('.nearest({column}) throws when the named column is not a vector', () => {
    expect(() => ArtikelEmbedding.objects.nearest([1, 2], {column: 'objectRef'})).toThrow(
      /not a vector column/
    )
  })
})
