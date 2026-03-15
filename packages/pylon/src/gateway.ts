import {Context, getContext, getResolveInfo} from '@getcronit/pylon'
import {delegateToSchema, Transform} from '@graphql-tools/delegate'
import {buildHTTPExecutor} from '@graphql-tools/executor-http'
import {schemaFromExecutor, wrapSchema} from '@graphql-tools/wrap'
import {Kind, visit} from 'graphql'

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
 * MappedRegistry intercepts the lookup and safely maps over the PROPERTIES
 * of the resolved type. This prevents the TS2589 infinite recursion error.
 */
type MappedRegistry<R, P> = {
  [K in keyof R]: R[K] extends {__typename: infer Name}
    ? Name extends keyof P
      ? P[Name & keyof P] extends (...args: any) => infer Res
        ? {[Prop in keyof Res]: PatchSchema<Res[Prop], P, R>}
        : never
      : {[Prop in keyof R[K]]: PatchSchema<R[K][Prop], P, R>}
    : {[Prop in keyof R[K]]: PatchSchema<R[K][Prop], P, R>}
}

type PatchSchema<T, P, R> = T extends Primitive
  ? T
  : // ✅ 1. Intercept resolver functions and unwrap them to their returned data
    T extends (...args: any[]) => infer Ret
    ? PatchSchema<Awaited<Ret>, P, R>
    : // ✅ 2. Handle Arrays
      T extends Array<infer U>
      ? Array<PatchSchema<U, P, R>>
      : // ✅ 3. Safely map nested objects and typenames
        T extends {__typename: infer Name}
        ? Name extends keyof R
          ? MappedRegistry<R, P>[Name & keyof R] // Safely bounces through MappedRegistry
          : {[K in keyof T]: PatchSchema<T[K], P, R>}
        : T extends object
          ? {[K in keyof T]: PatchSchema<T[K], P, R>}
          : T

// ✅ Store a Promise in the cache to prevent concurrent introspection race conditions
const schemaCache = new Map<string, Promise<any>>()

class PylonPatchTransform<TPatch> implements Transform {
  constructor(private patches: TPatch) {}

  // 1. Force __typename into the request (Replacing our previous fix)
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

  // 2. Apply your patches to the result automatically
  transformResult(originalResult: any) {
    return this.applyTransforms(originalResult)
  }

  private applyTransforms(data: any): any {
    if (!data || typeof data !== 'object') return data
    if (Array.isArray(data)) return data.map(item => this.applyTransforms(item))

    const processedData = {...data}
    for (const key in processedData) {
      processedData[key] = this.applyTransforms(processedData[key])
    }

    const typeName = data.__typename
    const patchFn = (this.patches as any)[typeName]
    if (patchFn) return patchFn(processedData)

    return processedData
  }
}

class PylonGateway<
  TRegistry,
  TPatch extends Record<string, (data: any) => any>
> {
  constructor(
    private config: {
      url: string
      headers?: (ctx: any) => Record<string, string>
      patches: TPatch
    }
  ) {}

  private applyTransforms(data: any): any {
    if (!data || typeof data !== 'object') return data
    if (Array.isArray(data)) return data.map(item => this.applyTransforms(item))

    const processedData = {...data}
    for (const key in processedData) {
      // Processes children bottom-up so patches receive fully transformed nested objects
      processedData[key] = this.applyTransforms(processedData[key])
    }

    const typeName = data.__typename
    const patchFn = this.config.patches[typeName as keyof TPatch]
    if (patchFn) return patchFn(processedData)

    return processedData
  }

  public async delegate<K extends keyof TRegistry>(
    key: K,
    operationName: string,
    args: Record<string, any> = {}
  ): Promise<MappedRegistry<TRegistry, TPatch>[K]> {
    const {info} = getResolveInfo()
    const ctx = getContext()

    if (!info || !ctx) throw new Error('Pylon context missing')

    if (!schemaCache.has(this.config.url)) {
      const executor = buildHTTPExecutor({
        endpoint: this.config.url,
        headers: r => ({
          ...(this.config.headers ? this.config.headers(r?.context) : {})
        })
      })

      // ✅ Cache the promise instantly so parallel requests await the same introspection
      const schemaPromise = schemaFromExecutor(executor).then(schema =>
        wrapSchema({schema, executor})
      )
      schemaCache.set(this.config.url, schemaPromise)
    }

    const schema = await schemaCache.get(this.config.url)

    const result = await delegateToSchema({
      schema,
      operation: info.operation.operation,
      fieldName: operationName,
      args,
      context: ctx,
      info,
      transforms: [new PylonPatchTransform(this.config.patches)]
    })

    return result
  }
}

/**
 * Creates a factory for configuring a strongly-typed PylonGateway.
 *
 * By providing a type registry (`TRegistry`) representing your remote GraphQL schema,
 * you ensure that all subsequent configurations, schema patches, and delegated queries
 * are fully type-safe.
 *
 * @template TRegistry - A type map/registry matching GraphQL typenames to their TypeScript interfaces.
 * @returns An object containing a `configure` method to initialize the gateway.
 *
 * @example
 *
 * Pull the remote schema using `pylon pull <url> -n <name>`
 *
 * ```typescript
 * import { createGateway } from '@getcronit/pylon';
 * import { RemoteRegistry } from './generated/remote'; // Generated by pylon-dev pull
 *
 * const gateway = createGateway<RemoteRegistry>().configure({
 *   url: '[https://api.example.com/graphql](https://api.example.com/graphql)',
 *   headers: (ctx) => ({ Authorization: ctx.token }),
 *   patches: {
 *     User: (data) => ({ ...data, fullName: `${data.firstName} ${data.lastName}` })
 *   }
 * });
 * ```
 */
export function createGateway<TRegistry>() {
  return {
    configure: <
      TPatch extends {
        [K in keyof TPatch]: K extends keyof TRegistry
          ? (data: TRegistry[K]) => any
          : never
      }
    >(config: {
      url: string
      headers?: (ctx: Context) => Record<string, string>
      patches: TPatch
    }) => {
      return new PylonGateway<TRegistry, TPatch>(config)
    }
  }
}
