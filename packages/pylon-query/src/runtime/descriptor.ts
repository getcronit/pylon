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
}

export interface SchemaDescriptor {
  /** Name of the root query type (usually "Query"). */
  query: string
  /** typeName → fieldName → FieldDesc. Only object types are included. */
  types: Record<string, Record<string, FieldDesc>>
}
