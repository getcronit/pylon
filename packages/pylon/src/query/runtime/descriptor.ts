/**
 * A compact, runtime description of the schema's object types — just enough for
 * the result wrapper (`./wrap`) to know, per field: its return type, whether it
 * is a list, whether it is a leaf (scalar/enum), and whether it takes arguments
 * (and is therefore callable in the `data.posts(args)` authoring style).
 *
 * This is the slim, owned equivalent of gqty's `generatedSchema` — but it only
 * drives read-shape, never a normalized cache. Emitted by
 * `build/describe-schema.ts` into the generated client.
 */
export interface FieldDesc {
  /** Named return type (the object type name, or scalar/enum name). */
  type: string
  /** True if the field returns a list. */
  list?: boolean
  /** True if the field's return type is a scalar or enum (a leaf). */
  scalar?: boolean
  /** True if the field declares arguments → callable as `data.field(args)`. */
  callable?: boolean
  /**
   * True if the field is callable but EVERY argument is optional. Such a field is
   * dual-mode: readable as a bare property (`data.field`, no args) OR called
   * (`data.field(args)`). A callable with any required arg is call-only.
   */
  optionalArgs?: boolean
  /**
   * True if the field's return type is non-null (`T!`). Lets the wrapper distinguish a
   * genuinely-nullable field (where `undefined`/`null` is a correct answer the app guards
   * with `?.`) from a non-null OBJECT field that is only TRANSIENTLY absent — e.g. a
   * connection that momentarily drops out of the op result during a refetch merge. The
   * schema says the latter can't be null, so the wrapper returns a null-safe sub-object
   * (nested reads degrade to `undefined`) instead of a bare `undefined` that throws on
   * `x.totalCount`. Emitted only for non-null fields, so absence = nullable (back-compat).
   */
  nonNull?: boolean
}

export interface SchemaDescriptor {
  /** Name of the root query type (usually "Query"). */
  query: string
  /** typeName → fieldName → FieldDesc. Only object types are included. */
  types: Record<string, Record<string, FieldDesc>>
}
