export function createDecorator(callback: (...args: any[]) => Promise<void>) {
  function MyDecorator<T extends (...args: any[]) => any>(
    target: Object,
    propertyKey: string | symbol
  ): void

  function MyDecorator<T>(fn: T): T

  function MyDecorator<T>(
    arg1: Object | T,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ): any {
    if (descriptor) {
      const originalMethod = descriptor.value as T

      descriptor.value = async function (...args: any[]) {
        await callback(...args)
        return (originalMethod as any).apply(this, args)
      }

      return descriptor
    } else {
      if (!descriptor) {
        if (propertyKey === undefined) {
          const originalFunction = arg1 as T

          return async function (
            ...args: Parameters<any>
          ): Promise<ReturnType<any>> {
            await callback(...args)
            return (originalFunction as any)(...args)
          } as T
        }

        let value: any = arg1[propertyKey]
        Object.defineProperty(arg1, propertyKey, {
          get: function () {
            return async function (...args: Parameters<any>) {
              await callback(...args)
              if (typeof value === 'function') {
                return value(...args)
              }

              return value
            }
          },
          set: function (newValue) {
            value = newValue
          },
          enumerable: true,
          configurable: true
        })

        return
      }
    }
  }

  return MyDecorator
}
