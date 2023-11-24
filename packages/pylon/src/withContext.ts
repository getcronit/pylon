import {LRUCache} from 'lru-cache'

export type Context<T = {}> = {
  req: Request
  res: Response
} & T

export interface BaseContext {
  req: Request
  res: Response
}

export type MaybeWithContext<T extends (...args: any[]) => any> = T & {
  wrappedWithContext: true | undefined
}

type MaybePromise<T> = T | Promise<T> | PromiseLike<T>
type Tuple<T> = [any, T, ...T[]]

type ArrayOrTuple<T> = Array<T> | Tuple<T>

export function decorator<In, Out extends MaybePromise<object | void> = void>(
  fn: (context: Context, params: In) => Out
) {
  return (context: Context, params: In): Out => {
    return fn(context, params)
  }
}

type Decorator = (context: Context, params: any) => MaybePromise<void | object>

export type ContextualFunction<
  T extends (...args: any[]) => any,
  RequiredContext
> = (context: Context<RequiredContext>) => T

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never

type MergedReturnType<T extends ((...args: any[]) => any)[]> =
  UnionToIntersection<
    {
      [K in keyof T]: T[K] extends (...args: any[]) => infer R ? R : never
    }[number]
  >

export function withContext<
  T extends (...args: any[]) => any,
  Args extends ArrayOrTuple<any> = [],
  Decorators extends Decorator[] = []
>(
  fn: ContextualFunction<T, Awaited<MergedReturnType<Decorators>>>,
  options?: {
    decorators?: Decorators
    decoratorsCache?: {
      max: number
      ttl: number
      maxAge?: number
    }
  }
) {
  const contextCache = new LRUCache(
    options?.decoratorsCache || {max: 1000, ttl: 1000 * 10}
  )

  const decorators = options?.decorators || []

  const wrappedFn =
    (context: BaseContext) =>
    async (...args: Args) => {
      let decoratedContext = context

      // @ts-ignore
      const contextCacheKey = context.req.id
      const cachedContext = contextCache.get(contextCacheKey) as
        | Context
        | undefined

      if (cachedContext) {
        decoratedContext = cachedContext
      } else {
        for (const decorator of decorators) {
          const partialContext = await decorator(decoratedContext, args as any)

          if (partialContext) {
            decoratedContext = {...decoratedContext, ...partialContext}
          }
        }

        contextCache.set(contextCacheKey, decoratedContext)
      }

      return fn(decoratedContext as any)(...args)
    }

  Object.defineProperty(wrappedFn, 'wrappedWithContext', {
    value: true,
    enumerable: false,
    configurable: false
  })

  // Overwrite the type of the function to be the original function in order to make the
  // @snek-at/function-builder work
  return wrappedFn as T
}

export type FnWithContext = ReturnType<typeof withContext>

export function bindWithContext<T extends (...args: any[]) => any>(
  context: BaseContext,
  fn: T
): (...args: Parameters<T>) => ReturnType<T> {
  const wrappedFn = withContext(fn, {decorators: []})
  return (...args: Parameters<T>) => wrappedFn(context)(...args)
}
