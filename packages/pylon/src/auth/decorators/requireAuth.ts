import {ServiceError} from '../../define-pylon'

export function requireAuth(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const originalMethod = descriptor.value

  descriptor.value = async function (...args: any[]) {
    const ctx = this.context

    const auth = ctx.get('auth')

    if (!auth?.active) {
      throw new ServiceError('Authentication required', {
        code: 'AUTH_REQUIRED',
        statusCode: 401,
        message: 'Authentication required. Please login.'
      })
    }

    return originalMethod.apply(this, args)
  }
}

export function requireRole(role: string) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      requireAuth(target, propertyKey, descriptor)

      const ctx = this.context

      const auth = ctx.get('auth')

      if (!auth?.active) {
        return new ServiceError('Authentication required', {
          code: 'AUTH_REQUIRED',
          statusCode: 401,
          message: 'Authentication required. Please login.'
        })
      }

      if (!auth.roles.includes(role)) {
        return new ServiceError('Authorization required', {
          code: 'AUTHORIZATION_REQUIRED',
          statusCode: 403,
          message: 'Authorization required. Please login.'
        })
      }

      return originalMethod.apply(this, args)
    }
  }
}
