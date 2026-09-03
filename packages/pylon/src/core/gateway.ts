import {delegateToSchema, Transform} from '@graphql-tools/delegate'
import {buildHTTPExecutor} from '@graphql-tools/executor-http'
import {schemaFromExecutor, wrapSchema} from '@graphql-tools/wrap'
import {
  ArgumentNode,
  FieldNode,
  getNamedType,
  GraphQLError,
  isEnumType,
  Kind,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  TypeInfo,
  ValueNode,
  visit,
  visitWithTypeInfo
} from 'graphql'
import type {Context} from './context'
import {getContext} from './context'
import {getResolveInfo} from './resolve-info'

type Primitive =
  | string
  | number
  | boolean
  | symbol
  | bigint
  | undefined
  | null
  | Date

/**
 * Recursively maps a GraphQL return type to a selection map for the `needs` object.
 * Allows boolean flags for selection and a special `__args` property for nested arguments.
 */
export type NeedsMap<T> = T extends Primitive
  ? boolean
  : // Unwrap function signatures so we can select fields on their return type
    T extends (...args: any[]) => infer Ret
    ? NeedsMap<Awaited<Ret>>
    : T extends Array<infer U>
      ? NeedsMap<U>
      : {
          [K in keyof T]?: NeedsMap<T[K]> | boolean
        } & {__args?: Record<string, any>}

/**
 * The fields a `needs` selection actually fetched, as a type.
 *
 * `NeedsMap` describes what you MAY ask for; this is the mirror — what you asked
 * for, so it can be read back. Without it `needs` is invisible to the checker:
 * the fields are fetched at runtime, are usually (deliberately) absent from the
 * patched type, and the only way to reach them is an unchecked cast that
 * re-states the selection by hand.
 *
 * Deliberately shallow-ish and forgiving: anything it cannot resolve degrades to
 * `unknown` rather than widening the whole result, so a `needs` shape it does not
 * understand never makes the patched half of the return worse.
 */
type NeedsResult<N, T> = T extends (...args: any[]) => infer R
  ? NeedsResult<N, Awaited<R>>
  : T extends Array<infer U>
    ? Array<NeedsResult<N, U>>
    : N extends true
      ? T
      : N extends object
        ? {
            [K in Exclude<keyof N, '__args'> &
              keyof NonNullable<T> as N[K] extends false | undefined
              ? never
              : K]: N[K] extends true
              ? NeedsField<NonNullable<T>[K]>
              : NeedsResult<N[K], NonNullable<T>[K]>
          }
        : unknown

/** A leaf `needs: true` — unwrap a callable field to what it returns. */
type NeedsField<T> = T extends (...args: any[]) => infer R ? Awaited<R> : T

/**
 * Maps over the properties of the resolved type within the registry.
 * Intercepting the lookup at the property level mitigates TS2589
 * (Type instantiation is excessively deep and possibly infinite) during recursive type inference.
 */
type MapValue<V, P, R> = V extends Primitive
  ? V
  : V extends Array<infer U>
    ? Array<PatchSchema<U, P, R>>
    : V extends {__typename: infer Name}
      ? Name extends keyof P
        ? P[Name & keyof P] extends (...args: any) => infer Res
          ? {[Prop in keyof Res]: PatchSchema<Res[Prop], P, R>}
          : never
        : {[Prop in keyof V]: PatchSchema<V[Prop], P, R>}
      : {[Prop in keyof V]: PatchSchema<V[Prop], P, R>}

type MappedRegistry<R, P> = {
  [K in keyof R]: MapValue<R[K], P, R>
}

type PatchSchema<T, P, R> = T extends Primitive
  ? T
  : // Preserve resolver function signatures & args, and patch their return types.
    T extends (...args: infer Args) => infer Ret
    ? (
        ...args: Args
      ) => Ret extends Promise<any>
        ? Promise<PatchSchema<Awaited<Ret>, P, R>>
        : PatchSchema<Awaited<Ret>, P, R>
    : // Recursively apply PatchSchema to array element types.
      T extends Array<infer U>
      ? Array<PatchSchema<U, P, R>>
      : // Route schema objects through MappedRegistry via __typename to maintain
        // type safety across graph boundaries without triggering circular reference limits.
        T extends {__typename: infer Name}
        ? Name extends keyof R
          ? MappedRegistry<R, P>[Name & keyof R]
          : {[K in keyof T]: PatchSchema<T[K], P, R>}
        : T extends object
          ? {[K in keyof T]: PatchSchema<T[K], P, R>}
          : T

// Implements a Promise-based cache to synchronize remote schema introspection
// and mitigate race conditions during concurrent initialization.
const schemaCache = new Map<string, Promise<any>>()

/**
 * The remote schema, introspected once per URL.
 *
 * The cache holds the PROMISE, which is what makes eviction on failure
 * essential: without it a single rejected introspection — the remote being down
 * when the first request happens to arrive — is replayed to every later request
 * for the life of the process, so the gateway never recovers from a remote
 * restart and reports a connection error for a remote that is demonstrably up.
 *
 * The delete is guarded on identity so a late rejection from a superseded
 * attempt cannot evict the entry a newer one already installed.
 */
export async function getRemoteSchema(
  url: string,
  makeExecutor: () => any
): Promise<any> {
  const cached = schemaCache.get(url)
  if (cached) return cached

  const executor = makeExecutor()
  const entry: Promise<any> = Promise.resolve(schemaFromExecutor(executor))
    .then(schema => wrapSchema({schema, executor}))
    .catch(err => {
      if (schemaCache.get(url) === entry) schemaCache.delete(url)
      throw new Error(
        `Gateway could not introspect the remote schema at ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {cause: err}
      )
    })
  schemaCache.set(url, entry)
  return entry
}

/** Test seam: drop every cached schema. */
export function __resetSchemaCache() {
  schemaCache.clear()
}

export interface GatewayContext<TRegistry extends {delegate: any; types: any}> {
  delegate: <
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    ...opts: {} extends TRegistry['delegate'][K]['args']
      ? [options?: {args?: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
      : [options: {args: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
  ) => Promise<TRegistry['delegate'][K]['return']> // We return the base type, patches are applied downstream
}

// --- AST Builder Utilities ---

function astFromJSValue(value: any): ValueNode {
  if (value === null || value === undefined) {
    return {kind: Kind.NULL}
  }
  if (typeof value === 'string') {
    return {kind: Kind.STRING, value}
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? {kind: Kind.INT, value: String(value)}
      : {kind: Kind.FLOAT, value: String(value)}
  }
  if (typeof value === 'boolean') {
    return {kind: Kind.BOOLEAN, value}
  }
  if (Array.isArray(value)) {
    return {
      kind: Kind.LIST,
      values: value.map(astFromJSValue)
    }
  }
  if (typeof value === 'object') {
    return {
      kind: Kind.OBJECT,
      fields: Object.entries(value)
        // Filter out undefined keys so they aren't sent to the remote graph
        .filter(([_, val]) => val !== undefined)
        .map(([key, val]) => ({
          kind: Kind.OBJECT_FIELD,
          name: {kind: Kind.NAME, value: key},
          value: astFromJSValue(val)
        }))
    }
  }

  // Fallback
  return {kind: Kind.STRING, value: String(value)}
}

function buildSelectionsFromNeeds(needs: Record<string, any>): SelectionNode[] {
  const selections: SelectionNode[] = []

  for (const [key, value] of Object.entries(needs)) {
    if (key === '__args' || !value) continue

    let selectionSet: SelectionSetNode | undefined = undefined
    let argsNodes: ArgumentNode[] | undefined = undefined

    if (typeof value === 'object') {
      const nestedSelections = buildSelectionsFromNeeds(value)

      if (nestedSelections.length > 0) {
        selectionSet = {
          kind: Kind.SELECTION_SET,
          selections: nestedSelections
        }
      }

      if (value.__args) {
        argsNodes = Object.entries(value.__args).map(
          ([argName, argVal]): ArgumentNode => ({
            kind: Kind.ARGUMENT,
            name: {kind: Kind.NAME, value: argName},
            value: astFromJSValue(argVal)
          })
        )
      }
    }

    selections.push({
      kind: Kind.FIELD,
      name: {kind: Kind.NAME, value: key},
      ...(selectionSet ? {selectionSet} : {}),
      ...(argsNodes ? {arguments: argsNodes} : {})
    } as FieldNode)
  }

  return selections
}

// --- Transforms ---

class InjectNeedsTransform implements Transform {
  constructor(private needs?: Record<string, any>) {}

  transformRequest(originalRequest: any) {
    if (!this.needs || Object.keys(this.needs).length === 0) {
      return originalRequest
    }

    const needsSelections = buildSelectionsFromNeeds(this.needs)
    let rootFieldFound = false

    const document = visit(originalRequest.document, {
      Field(node) {
        if (!rootFieldFound && node.selectionSet) {
          rootFieldFound = true

          const existingNames = new Set(
            node.selectionSet.selections
              .filter(s => s.kind === Kind.FIELD)
              .map((s: any) => s.name.value)
          )

          const mergedSelections = [...node.selectionSet.selections]

          for (const selection of needsSelections) {
            if (
              selection.kind === Kind.FIELD &&
              !existingNames.has(selection.name.value)
            ) {
              mergedSelections.push(selection)
            }
          }

          return {
            ...node,
            selectionSet: {
              ...node.selectionSet,
              selections: mergedSelections
            }
          }
        }
      }
    })

    return {...originalRequest, document}
  }
}

class InlineArgsTransform implements Transform {
  constructor(private wrapperArgs: Record<string, any>) {}

  transformRequest(originalRequest: any, delegationContext: any) {
    // 1. Parse the root args provided by your JS wrapper (if any)
    const rootInlineArguments =
      this.wrapperArgs && Object.keys(this.wrapperArgs).length > 0
        ? Object.entries(this.wrapperArgs)
            .filter(([_, val]) => val !== undefined)
            // Add the explicit ArgumentNode return type here!
            .map(
              ([key, value]): ArgumentNode => ({
                kind: Kind.ARGUMENT,
                name: {kind: Kind.NAME, value: key},
                value: astFromJSValue(value)
              })
            )
        : []

    const targetFieldName = delegationContext.fieldName
    let targetFieldFound = false

    // graphql-tools safely extracts nested variables into this object
    const variables = originalRequest.variables || {}

    let inlineDocument = visit(originalRequest.document, {
      // A. Inject our wrapper args into the ROOT field
      Field(node) {
        if (!targetFieldFound && node.name.value === targetFieldName) {
          targetFieldFound = true

          const existingArgs = node.arguments || []
          const mergedArgs = [...existingArgs]

          for (const newArg of rootInlineArguments) {
            const existingIdx = mergedArgs.findIndex(
              a => a.name.value === newArg.name.value
            )
            if (existingIdx > -1) mergedArgs[existingIdx] = newArg
            else mergedArgs.push(newArg)
          }

          return {...node, arguments: mergedArgs}
        }
      },

      // B. PRUNE missing arguments entirely
      Argument(node) {
        if (node.value.kind === Kind.VARIABLE) {
          const varName = node.value.name.value
          if (!(varName in variables) || variables[varName] === undefined) {
            return null // Deletes `first: $a70fde` from the AST
          }
        }
      },

      // C. PRUNE missing input object fields entirely (e.g. filters: { status: $missing })
      ObjectField(node) {
        if (node.value.kind === Kind.VARIABLE) {
          const varName = node.value.name.value
          if (!(varName in variables) || variables[varName] === undefined) {
            return null // Deletes the field from the input object
          }
        }
      },

      // D. Inline all surviving variables (and safely fallback to NullNode just in case)
      Variable(node) {
        const varName = node.name.value
        return astFromJSValue(variables[varName])
      },

      // E. Wipe variable definitions
      OperationDefinition(node) {
        return {...node, variableDefinitions: []}
      }
    })

    // 3. Run the TypeInfo pass over the FULL document.
    // This ensures both root and nested string AST nodes are correctly coerced to Enums!
    const typeInfo = new TypeInfo(delegationContext.targetSchema)
    inlineDocument = visit(
      inlineDocument,
      visitWithTypeInfo(typeInfo, {
        StringValue(node) {
          const inputType = typeInfo.getInputType()
          if (inputType) {
            const namedType = getNamedType(inputType)
            if (isEnumType(namedType)) {
              return {kind: Kind.ENUM, value: node.value}
            }
          }
        }
      })
    )

    return {
      ...originalRequest,
      document: inlineDocument,
      variables: {} // Wipe the payload, we don't need it anymore!
    }
  }
}

/**
 * The argument policy for one field of a patched type.
 *
 * `args` is an ALLOWLIST: name the arguments a caller may set. Anything else is
 * rejected, so an argument the remote adds later is denied by default — the same
 * rule fields already follow. Omit it to allow everything.
 *
 * `force` is applied to the outgoing request and OVERRIDES whatever the caller
 * sent. It is a constraint, not a default. Values are constants, or
 * `(ctx) => value` for per-request ones. A forced argument is always allowed,
 * whether or not it appears in `args`.
 */
export interface FieldPolicy {
  args?: readonly string[]
  force?: Record<string, unknown | ((ctx: any) => unknown)>
}

/** Per-field policies for one patched type, keyed by field name. */
export type PatchPolicy = Record<string, FieldPolicy>

const POLICY = Symbol.for('pylon.gateway.policy')

/**
 * Attach an argument policy to a patch.
 *
 * A patch transforms the RESULT of a delegated field, so on its own it cannot
 * constrain what was ASKED FOR: by the time it runs, the caller's arguments have
 * already reached the remote. A filter applied in one resolver therefore does not
 * apply to the same rows reached through a nested field.
 *
 *     patches: {
 *       ProductCollection: pass(
 *         c => ({handle: c.handle, name: c.name, products: c.products}),
 *         {
 *           products: {
 *             args: ['first', 'last', 'after', 'before', 'skip'],
 *             force: {query: 'status:ACTIVE published:true'}
 *           }
 *         }
 *       )
 *     }
 *
 * The type name comes from the patch's own key, so it is never repeated. Root
 * fields need nothing here: a delegated root field is called from your own
 * resolver, which already decides its arguments.
 *
 * The patch is returned unchanged — its signature, and so the schema it
 * generates, is untouched.
 */
export function pass<D, A, R>(
  patch: (data: D, api: A) => R,
  policy: PatchPolicy
): (data: D, api: A) => R {
  // Generic in the PARAMETERS rather than in the whole function type: a
  // `F extends (data: any, ...) => any` constraint types `data` as `any` before
  // the surrounding `patches` map can contextually type it, so the patch loses
  // the registry type of its own argument and every spread degrades to `any`.
  Object.defineProperty(patch, POLICY, {value: policy, enumerable: false})
  return patch
}

/** Collect `Type.field` → policy from a patch map. */
function collectPolicies(patches: any): Map<string, FieldPolicy> {
  const out = new Map<string, FieldPolicy>()
  for (const [typeName, patch] of Object.entries(patches ?? {})) {
    const policy = (patch as any)?.[POLICY] as PatchPolicy | undefined
    if (!policy) continue
    for (const [field, fieldPolicy] of Object.entries(policy)) {
      out.set(`${typeName}.${field}`, fieldPolicy)
    }
  }
  return out
}

/**
 * Applies field policies to the outgoing request.
 *
 * Two jobs, both impossible from a result-side patch:
 *
 *   - REJECT an argument outside the allowlist, so a caller cannot reach a knob
 *     the boundary never granted — including one the remote added after this
 *     gateway was written;
 *   - FORCE an argument, overriding whatever the caller sent.
 *
 * Both rewrite the document that goes upstream, so the nested selection still
 * travels inside its parent's single request and nothing here costs a round trip.
 *
 * `InlineArgsTransform` cannot do this job: it matches only the root field
 * (`delegationContext.fieldName`), which is why nested arguments are otherwise
 * out of reach.
 */
export class ForceArgsTransform implements Transform {
  constructor(
    private policies: Map<string, FieldPolicy> | undefined,
    private ctx: any
  ) {}

  transformRequest(originalRequest: any, delegationContext: any) {
    if (!this.policies || this.policies.size === 0) return originalRequest

    // Resolve `(ctx) => value` entries once per request, not once per node.
    const forced = new Map<string, ArgumentNode[]>()
    for (const [key, policy] of this.policies) {
      const nodes: ArgumentNode[] = []
      for (const [name, value] of Object.entries(policy.force ?? {})) {
        const v = typeof value === 'function' ? (value as any)(this.ctx) : value
        if (v === undefined) continue
        nodes.push({
          kind: Kind.ARGUMENT,
          name: {kind: Kind.NAME, value: name},
          value: astFromJSValue(v)
        })
      }
      forced.set(key, nodes)
    }

    const policies = this.policies
    // The parent type of each field is only knowable with a type-info walk —
    // the document alone says `products`, not which `products`.
    const typeInfo = new TypeInfo(delegationContext.targetSchema)
    const document = visit(
      originalRequest.document,
      visitWithTypeInfo(typeInfo, {
        Field(node) {
          const parent = typeInfo.getParentType()
          if (!parent) return
          const key = `${parent.name}.${node.name.value}`
          const policy = policies.get(key)
          if (!policy) return

          const forcedNodes = forced.get(key) ?? []

          // Deny first: an argument outside the allowlist must fail, not be
          // quietly dropped — silently discarding a filter changes what the
          // caller asked for without telling them.
          if (policy.args) {
            const allowed = new Set<string>([
              ...policy.args,
              ...Object.keys(policy.force ?? {})
            ])
            for (const arg of node.arguments ?? []) {
              if (!allowed.has(arg.name.value)) {
                throw new GraphQLError(
                  `Argument "${arg.name.value}" is not allowed on "${key}".`,
                  {
                    nodes: [arg],
                    extensions: {
                      code: 'GATEWAY_ARGUMENT_NOT_ALLOWED',
                      field: key,
                      argument: arg.name.value,
                      allowed: [...allowed].sort()
                    }
                  }
                )
              }
            }
          }

          if (forcedNodes.length === 0) return

          const merged = [...(node.arguments || [])]
          for (const arg of forcedNodes) {
            const i = merged.findIndex(a => a.name.value === arg.name.value)
            // Override, never merge: a caller-supplied value must not survive.
            if (i > -1) merged[i] = arg
            else merged.push(arg)
          }
          return {...node, arguments: merged}
        }
      })
    )

    return {...originalRequest, document}
  }
}

export class PylonPatchTransform<TPatch> implements Transform {
  constructor(
    private patches: TPatch,
    private api: any,
    private strict = false
  ) {}

  // Injects __typename into all selection sets via AST traversal to ensure
  // deterministic resolution of interface/union types for downstream runtime transformations.
  transformRequest(originalRequest: any) {
    const document = visit(originalRequest.document, {
      SelectionSet(node) {
        const hasTypename = node.selections.some(
          s => s.kind === Kind.FIELD && s.name.value === '__typename'
        )
        if (!hasTypename) {
          return {
            ...node,
            selections: [
              ...node.selections,
              {
                kind: Kind.FIELD,
                name: {kind: Kind.NAME, value: '__typename'}
              }
            ]
          }
        }
      }
    })
    return {...originalRequest, document}
  }

  // Intercepts the execution phase to recursively apply registered patches to the payload.
  transformResult(originalResult: any) {
    return this.applyTransforms(originalResult)
  }

  private applyTransforms(data: any): any {
    if (!data || typeof data !== 'object') return data

    // An Error is a RESULT, not data. Delegation returns one when the remote
    // rejected the request, and spreading it below would strip its prototype:
    // `{...err} instanceof Error` is false, so the executor stops treating it
    // as a failure and tries to COMPLETE it as the field's type. A remote
    // "Session not found" then surfaces to the caller as
    // "Cannot return null for non-nullable field X.y" — pointing at an
    // unrelated field, with the real cause gone.
    if (data instanceof Error) return data

    if (Array.isArray(data)) return data.map(item => this.applyTransforms(item))

    const processedData = {...data}
    for (const key in processedData) {
      processedData[key] = this.applyTransforms(processedData[key])
    }

    const typeName = data.__typename
    // `patches` is optional — a pure pass-through gateway has none. Guard the lookup
    // so a patch-less gateway doesn't crash on `undefined[typeName]`.
    const patchFn = typeName ? (this.patches as any)?.[typeName] : undefined

    // Default-deny. Without this, a type reachable through a patched field but
    // not itself patched is published WHOLE — so the patch map is an allowlist
    // only for the types someone remembered, and a type the remote adds later
    // arrives in the public schema with no code change and nothing to review.
    // `strict` turns that omission into a failure. Opt-in, because switching it
    // on removes types an existing gateway is already serving.
    if (this.strict && typeName && !patchFn) {
      throw new Error(
        `Gateway (strict): no patch for remote type "${typeName}", so it would ` +
          `be exposed in full. Add a patch for it, or declare it deliberately ` +
          `with \`${typeName}: passthrough()\`.`
      )
    }

    if (patchFn) {
      const patchedData = patchFn(processedData, this.api)

      // Safely merge the patched result WITH the original processedData.
      // This ensures that any dynamically aliased keys (e.g., 'b5c5d1')
      // are strictly preserved, even if the patch function forgets (or chooses not) to spread them.
      if (
        patchedData &&
        typeof patchedData === 'object' &&
        !Array.isArray(patchedData)
      ) {
        return {
          ...processedData,
          ...patchedData
        }
      }

      return patchedData
    }

    return processedData
  }
}

// --- Main Gateway Class ---

class PylonGateway<
  TRegistry extends {delegate: any; types: any},
  TPatch extends Record<string, (data: any, api: any) => any>
> {
  private apiContext: GatewayContext<TRegistry>

  constructor(
    private config: {
      url: string
      headers?: (ctx: any) => Record<string, string>
      patches?: TPatch
      strict?: boolean
    }
  ) {
    this.apiContext = {
      delegate: this.delegate.bind(this) as any
    }
    // Collected once: the policies are static, and the type name each one
    // belongs to is the patch's own key.
    this.policies = collectPolicies(this.config.patches)
  }

  private policies: Map<string, FieldPolicy>

  /**
   * Delegate with a guard — the result is `null` when the guard rejects it.
   *
   * The guard's argument is typed from `needs`, which is the only way to read
   * back a field you fetched purely to decide with. Intersecting those fields
   * into the RETURN type instead does not work: an intersection is a
   * structurally new type, so the schema builder mints a second `Org_1`
   * alongside `Org` and then rejects the duplicate. Keeping them inside the
   * guard leaves the returned type — the one the schema is generated from —
   * exactly as it was.
   */
  public async delegate<
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    options: {
      args?: TRegistry['delegate'][K]['args']
      needs?: TNeeds
      guard: (data: NeedsResult<TNeeds, TRegistry['delegate'][K]['return']>) => boolean
    }
  ): Promise<PatchSchema<
    TRegistry['delegate'][K]['return'],
    TPatch,
    TRegistry['types']
  > | null>

  public async delegate<
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    ...opts: {} extends TRegistry['delegate'][K]['args']
      ? [options?: {args?: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
      : [options: {args: TRegistry['delegate'][K]['args']; needs?: TNeeds}]
  ): Promise<
    PatchSchema<TRegistry['delegate'][K]['return'], TPatch, TRegistry['types']>
  >

  public async delegate<
    K extends keyof TRegistry['delegate'],
    TNeeds extends NeedsMap<TRegistry['delegate'][K]['return']> = NeedsMap<
      TRegistry['delegate'][K]['return']
    >
  >(
    key: K,
    ...opts: [
      options?: {
        args?: TRegistry['delegate'][K]['args']
        needs?: TNeeds
        guard?: (data: any) => boolean
      }
    ]
  ): Promise<any> {
    const {info} = getResolveInfo()
    const ctx = getContext()

    if (!info || !ctx) throw new Error('Pylon context missing')

    // Extract args and needs from the unified options object
    const options = opts[0] as
      | {args?: any; needs?: any; guard?: (data: any) => boolean}
      | undefined
    const args = options?.args || {}
    const needs = options?.needs
    const guard = options?.guard

    const [rootType, fieldName] = String(key).split('.')

    if (!rootType || !fieldName) {
      throw new Error(
        `Invalid delegate key format: ${String(key)}. Expected "Operation.field"`
      )
    }

    const operationMap: Record<string, OperationTypeNode> = {
      Query: OperationTypeNode.QUERY,
      Mutation: OperationTypeNode.MUTATION,
      Subscription: OperationTypeNode.SUBSCRIPTION
    }

    const operation = operationMap[rootType]

    // Validate operation type against supported GraphQL root nodes.
    if (!operation) {
      throw new Error(
        `Unsupported operation type "${rootType}" in key "${String(key)}"`
      )
    }

    const schema = await getRemoteSchema(this.config.url, () =>
      buildHTTPExecutor({
        endpoint: this.config.url,
        headers: r => ({
          ...(this.config.headers ? this.config.headers(r?.context) : {})
        })
      })
    )

    const result = await delegateToSchema({
      schema,
      operation: operation,
      fieldName: fieldName,
      args: args,
      context: ctx,
      info,
      transforms: [
        new InjectNeedsTransform(needs), // Injects requested AST fields
        new InlineArgsTransform(args), // Injects arguments into the AST
        // Last of the request transforms, so a forced argument overrides one
        // the caller passed AND one `needs` wrote — it is the boundary, and
        // nothing upstream of it in this list gets to widen it.
        new ForceArgsTransform(this.policies, ctx),
        new PylonPatchTransform(this.config.patches, this.apiContext, this.config.strict)
      ]
    })

    // THROW a delegation error rather than returning it.
    //
    // `delegateToSchema` hands back a `GraphQLError` when the remote rejected
    // the request. Returning it makes it the field's VALUE, and the executor
    // then completes it as the field's type: a remote "Session not found"
    // surfaces as `Organisation.name === "GraphQLError"` (the error's own
    // `name`) and `Cannot return null for non-nullable field
    // Organisation.locations` for everything else — the real cause gone, the
    // blame on an unrelated field. Throwing is what every executor reads as a
    // field failure, so the upstream message and extensions reach the caller.
    if (result instanceof Error) throw result

    // A rejected row is `null`, not an error: "not visible to you" and "does not
    // exist" are the same answer to a caller who may not know the difference.
    if (guard && result != null && !guard(result)) return null as any

    return result as any
  }
}

/**
 * Instantiates a factory for configuring a strongly-typed PylonGateway.
 *
 * Utilizes a generated type registry (`TRegistry`) mapping remote GraphQL typenames
 * to TypeScript interfaces, guaranteeing end-to-end type safety for configurations,
 * schema patches, and delegated execution payloads.
 *
 * @template TRegistry - Type map correlating GraphQL typenames to local TypeScript definitions.
 * @returns Gateway configuration interface.
 *
 * @example
 *
 * // Provision remote schema via CLI: pylon pull <url> -n <name>
 *
 * ```typescript
 * import { createGateway } from '@getcronit/pylon';
 * import { RemoteRegistry } from '../generated/remote';
 *
 * const gateway = createGateway<RemoteRegistry>().configure({
 * url: '[https://api.example.com/graphql](https://api.example.com/graphql)',
 * headers: (ctx) => ({ Authorization: ctx.token }),
 * patches: {
 * User: (data, api) => ({ ...data, fullName: `${data.firstName} ${data.lastName}` })
 * }
 * });
 * ```
 */
/**
 * Marks a remote type as deliberately exposed in full.
 *
 * Only meaningful under `strict`, where an unpatched type is an error. Using
 * this says "every field of this type, now and as the remote adds them, is
 * public" — which is a real decision for a leaf like `Money`, and a mistake for
 * anything else.
 */
export function passthrough<T>(): (data: T) => T {
  return data => data
}

export function createGateway<TRegistry extends {delegate: any; types: any}>() {
  return {
    configure: <
      TPatch extends {
        [K in keyof TPatch]: K extends keyof TRegistry['types']
          ? (data: TRegistry['types'][K], api: GatewayContext<TRegistry>) => any
          : never
      }
    >(config: {
      url: string
      headers?: (ctx: Context) => Record<string, string>
      patches?: TPatch
      /**
       * Fail on a remote type that has no patch, instead of publishing it whole.
       *
       * Off by default: turning it on removes types an existing gateway is
       * already serving, which is the point, but it is a breaking change to
       * adopt. Types that genuinely should pass through say so with
       * `passthrough()`, so it reads as a decision rather than an omission.
       */
      strict?: boolean
    }) => {
      return new PylonGateway<TRegistry, TPatch>(config)
    }
  }
}
