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
export {emptyIR, tableSpecOf, joinTableName, joinColumn, pgIdent} from './ir.js'
export {toSDL, renderType} from './sdl.js'
export {toDDL, columnDDL, sqlTypeDDL, sqlDefaultLiteral} from './ddl.js'
export {postgres, type Dialect} from './dialect.js'
export {
  mergeIR,
  mergeFields,
  pruneUnreferencedEnums,
  pruneUnreferencedObjectTypes,
  collapseInterfaceTwins
} from './merge.js'
export {
  diffEntities,
  diffSchema,
  physicalSchemaOf,
  makeMigration,
  renderChanges,
  applyChanges,
  isDestructive,
  backfillWarnings,
  describeChange,
  renameCandidates,
  tableRenameCandidates
} from './diff.js'
export type {SchemaChange, Migration, Rename, TableRename, CastHint} from './diff.js'
