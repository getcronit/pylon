/**
 * Capability-tier authorization — "may this principal perform this operation?".
 * Needs ONLY the Principal (no ORM), so it secures resolvers and routes on bare
 * core + an identity provider. pylon-app extends `authorize` with the resource
 * tier (rows/instances/fields via WhereInput).
 */
import type {Context, Plugin} from '@getcronit/pylon'
import {getContext} from '@getcronit/pylon'
import {GraphQLError} from 'graphql'
import {hasRole, type IdentityProvider, type Principal} from './principal.js'

const PRINCIPAL_KEY = 'principal'

/** Authorization denial → surfaced to clients as a `FORBIDDEN` GraphQL error. */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN'
  readonly statusCode = 403
  constructor(message = 'Not permitted.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** The current request's Principal (set by `useIdentity`), or undefined. */
export function getPrincipal(): Principal | undefined {
  try {
    return getContext().get(PRINCIPAL_KEY as never) as Principal | undefined
  } catch {
    return undefined // no request context bound (e.g. outside a request)
  }
}

/** Capability gate: throws `ForbiddenError` if the check fails. Works on bare core. */
export function authorize(check: (principal: Principal | undefined) => boolean): void {
  if (!check(getPrincipal())) throw new ForbiddenError()
}

/** Require ANY of the given roles on the current principal (sugar over `authorize`). */
export function requireRole(...roles: string[]): void {
  authorize(p => hasRole(p, ...roles))
}

/**
 * Bind the request's Principal from any identity provider, and map authz errors.
 * The principal lives on the request context, so resolvers/routes read it via
 * `getPrincipal()`. `ForbiddenError` thrown anywhere downstream is mapped to a
 * `FORBIDDEN` GraphQL error (not masked).
 */
export function useIdentity(provider: IdentityProvider<Context>): Plugin {
  return {
    async middleware(c, next) {
      c.set(PRINCIPAL_KEY as never, (await provider(c)) as never)
      await next()
    },
    onExecute() {
      return {
        onExecuteDone({result, setResult}) {
          if (result == null || typeof (result as any)[Symbol.asyncIterator] === 'function') return
          const errors = (result as {errors?: readonly GraphQLError[]}).errors
          if (!Array.isArray(errors) || errors.length === 0) return
          let changed = false
          const mapped = errors.map(err => {
            if (err.originalError instanceof ForbiddenError) {
              changed = true
              return new GraphQLError(err.originalError.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'FORBIDDEN'}
              })
            }
            return err
          })
          if (changed) setResult({...result, errors: mapped})
        }
      }
    }
  }
}
