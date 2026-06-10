export type {
  TypeRef,
  ScalarName,
  SqlType,
  OnDelete,
  ColumnSpec,
  RelationSpec,
  IndexSpec,
  ForeignKeyChange,
  TableSpec,
  TableColumn,
  PhysicalTable,
  PhysicalSchema,
  Field,
  Entity,
  ObjectType,
  InterfaceType,
  UnionType,
  InputType,
  EnumType,
  Operation,
  PylonIR
} from './ir.js'
export {emptyIR, tableSpecOf} from './ir.js'
export {toSDL, renderType} from './sdl.js'
export {toDDL, columnDDL, sqlTypeDDL} from './ddl.js'
export {mergeIR, mergeFields} from './merge.js'
export {
  diffEntities,
  diffSchema,
  physicalSchemaOf,
  makeMigration,
  renderChanges,
  applyChanges,
  isDestructive,
  renameCandidates
} from './diff.js'
export type {SchemaChange, Migration, Rename} from './diff.js'
