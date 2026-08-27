// ── Runtime ──────────────────────────────────────────────────────────────
export {doc, opKey} from './runtime/doc'
export type {ConnectionMeta, DocInit, ShapeField, TypedDoc} from './runtime/doc'
export type {FieldDesc, SchemaDescriptor} from './runtime/descriptor'
export {Store} from './runtime/store'
export type {StoreEntry} from './runtime/store'
export {
  defaultFetcher,
  createServerFetcher,
  type FetcherOptions,
  type FetcherResult,
  type GraphQLRequest
} from './runtime/fetcher'
export {
  createPylonQueryClient,
  GraphQLResultError,
  PylonQueryClient,
  type Fetcher,
  type PylonQueryClientOptions,
  type QueryRead
} from './runtime/client'
export {wrapResult, type Deref} from './runtime/wrap'
export {variablesHash, stableStringify, hashString} from './runtime/hash'
export {
  normalize,
  isRef,
  entityKey,
  type Ref,
  type NormalizeResult
} from './runtime/normalize'

// ── React ────────────────────────────────────────────────────────────────
export {PylonQueryProvider, usePylonQueryClient} from './react/context'
export {
  useQueryDoc,
  type UseQueryDocOptions,
  type WithRefetch
} from './react/use-query-doc'
export {
  usePaginatedDoc,
  type PageInfo,
  type PaginatedResult,
  type UsePaginatedDocOptions
} from './react/use-paginated-doc'
export {
  useMutationDoc,
  type MutationState,
  type MutationTrigger
} from './react/use-mutation-doc'
export {
  op,
  registerOperationClient,
  type Operation
} from './runtime/operation'
