/**
 * Client-side id generators for text primary keys — the portable answer to
 * Prisma's `@default(cuid())` / `@default(uuid())`. Use as a function default:
 *
 * ```ts
 * class User extends Model {
 *   id = text({primaryKey: true, default: createId})   // collision-resistant id
 *   // or: id = text({primaryKey: true, default: uuidv4})
 * }
 * ```
 *
 * `default` being a *function* marks it a generator: it is resolved at insert
 * time (never serialized to the migration/DDL). For an exact cuid format, plug
 * in your own — e.g. `@paralleldrive/cuid2`'s `createId` — the mechanism is the
 * same; these are the dependency-free built-ins.
 */
import {randomBytes, randomUUID} from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

/**
 * A collision-resistant, URL-safe, letter-prefixed id (cuid2-style: a leading
 * letter so it's a valid identifier, then base36 of 128 bits of CSPRNG
 * entropy). Not the canonical cuid2 algorithm (no host fingerprint/counter),
 * but well-suited to primary keys and dependency-free.
 */
export function createId(): string {
  const buf = randomBytes(16)
  let n = 0n
  for (const b of buf) n = (n << 8n) | BigInt(b)
  const body = n.toString(36).padStart(24, '0').slice(-23)
  return ALPHABET[buf[0] % 26] + body
}

/** A v4 UUID string (delegates to the platform CSPRNG). */
export function uuidv4(): string {
  return randomUUID()
}
