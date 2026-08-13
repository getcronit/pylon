/**
 * `Gid` — a value object for global ids, modelled on `URL`.
 *
 * When an app enables `node: true`, the API returns every `id` as a
 * `gid://<namespace>/<Type>/<localId>` handle. That's the canonical id (cache
 * keys, `node(id)` refetch, mutation args), but it contains `/` and `:`, so it
 * can't go straight into a route path. Like Shopify's admin, you route on the
 * **local id** (`Gid.id(x)`) and keep the gid for the data layer.
 *
 * ```ts
 * new Gid('gid://pylon/Ticket/1780').id     // '1780'   (throws on a bad gid, like `new URL`)
 * Gid.parse(x)?.type                         // 'Ticket' | undefined   (null-safe, like URL.parse)
 * Gid.id(ticket.id)                          // local id for routes — tolerant no-op on raw ids
 * Gid.from('Ticket', '1780').toString()      // 'gid://pylon/Ticket/1780'   (rebuild for node())
 * ```
 */

// gid://<ns>/<Type>/<localId…> — localId may itself contain '/', so it's the
// remainder after the third separator.
const GID_RE = /^gid:\/\/([^/]+)\/([^/]+)\/(.+)$/

// The namespace used when REBUILDING a gid (`Gid.from`). Parsing never needs it —
// the namespace is read out of the string — so this only matters for apps that set
// a custom `node: {namespace}` and reconstruct a gid from a bare local id. Defaults
// to Pylon's default namespace.
let defaultNamespace = 'pylon'

export class Gid {
  /** URI namespace segment (e.g. `pylon`, or the app's node namespace). */
  readonly namespace: string
  /** GraphQL type name the id belongs to. */
  readonly type: string
  /** The raw local id (a snowflake / cuid / uuid) — what you route and display on. */
  readonly id: string

  /** Parse a gid string. Throws `TypeError` on a malformed value (like `new URL`). */
  constructor(input: string) {
    const m = typeof input === 'string' ? GID_RE.exec(input) : null
    if (!m) throw new TypeError(`Invalid gid: ${JSON.stringify(input)}`)
    this.namespace = m[1]
    this.type = m[2]
    this.id = m[3]
  }

  /** The canonical gid string. */
  toString(): string {
    return `gid://${this.namespace}/${this.type}/${this.id}`
  }

  /** Serialize to the gid string in JSON, so a `Gid` round-trips as a query variable. */
  toJSON(): string {
    return this.toString()
  }

  /** Non-throwing parse (à la `URL.parse`). Returns a `Gid`, or `null` for non-gids. */
  static parse(input: unknown): Gid | null {
    if (input instanceof Gid) return input
    try {
      return new Gid(input as string)
    } catch {
      return null
    }
  }

  /**
   * Build a gid from its parts — e.g. to call `node(id)` from a route param.
   * `namespace` defaults to the configured one (see {@link Gid.configure}).
   */
  static from(type: string, id: string, namespace = defaultNamespace): Gid {
    return new Gid(`gid://${namespace}/${type}/${id}`)
  }

  /**
   * Set the namespace `Gid.from` uses when rebuilding gids — call once at client
   * startup with the same value as the server's `node: {namespace}`.
   * Only needed if the app customised the namespace AND reconstructs gids from
   * bare local ids; parsing works with any namespace without this.
   */
  static configure(options: {namespace: string}): void {
    defaultNamespace = options.namespace
  }

  /** The namespace `Gid.from` currently rebuilds with. */
  static get defaultNamespace(): string {
    return defaultNamespace
  }

  /**
   * The local id to route/display on — a gid's last segment, or the value itself
   * if it isn't a gid. Tolerant, so `` `/tickets/${Gid.id(ticket.id)}` `` works
   * whether `node` is on (strips the gid) or off (passes the raw id through).
   */
  static id(value: string): string {
    return Gid.parse(value)?.id ?? value
  }

  /** True for a well-formed `gid://…` string. */
  static is(value: unknown): value is string {
    return Gid.parse(value) !== null
  }
}
