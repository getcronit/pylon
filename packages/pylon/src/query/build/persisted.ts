import {createHash} from 'crypto'

/**
 * Content-addressed document id. Stable across server and client builds (same
 * body → same id), so it doubles as the cache + hydration key and, later, a
 * persisted-query identifier. SHA-256 truncated to 16 hex chars + a `q` prefix.
 */
export function documentId(body: string): string {
  return 'q' + createHash('sha256').update(body).digest('hex').slice(0, 16)
}
