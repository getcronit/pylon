import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {compileOperation, type SelectorNode} from '@/query/build/compile'
import {describeSchema} from '@/query/build/describe-schema'
import {createPylonQueryClient} from '@/query/runtime/client'
import {doc, opKey, type TypedDoc} from '@/query/runtime/doc'

/**
 * Adversarial proof that the completeness gate makes a PARTIAL READ structurally
 * impossible on the render path. Each test drives the FULL chain — the real
 * compiler emits the selection `shape`, the client gate decides what `ensure`
 * hands back, and `wrapResult` reads it exactly as component code would — and
 * tries to make a `undefined` hole reach a read. The gate must always either
 * suspend (return a promise, never data) or serve COMPLETE data.
 */
const schema = buildSchema(/* GraphQL */ `
  type Query {
    ticket: Ticket
  }
  type Ticket {
    id: ID!
    timeline: Timeline!
    assignee: User
  }
  type Timeline {
    totalCount: Int!
  }
  type User {
    id: ID!
    name: String
  }
`)
const descriptor = describeSchema(schema)

/** Compile a selector with the REAL compiler, so the shape is authentic. */
function makeDoc<T = any>(selector: SelectorNode, name: string): TypedDoc<T> {
  const c = compileOperation(schema, selector, {name})
  return doc<T>({id: `op_${name}`, body: c.body, name, shape: c.shape})
}

const WIDE = makeDoc(
  {ticket: {id: true, timeline: {totalCount: true}, assignee: {id: true, name: true}}},
  'Wide'
)

/** A read of the op's data as component code would perform it (wrapped + deref'd). */
const readWrapped = (client: ReturnType<typeof createPylonQueryClient>, data: unknown) =>
  client.wrapData<any>(() => data)

describe('partial reads are structurally impossible on the render path', () => {
  it('composer repro: a non-null connection absent from a shared entity SUSPENDS, never reads a hole', async () => {
    const full = {
      ticket: {
        __typename: 'Ticket',
        id: '1',
        timeline: {totalCount: 3, __typename: 'Timeline'},
        assignee: {__typename: 'User', id: '9', name: 'Ada'}
      }
    }
    const fetcher = vi.fn(async () => ({data: full}))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})

    // A narrower op populated Ticket:1 WITHOUT `timeline`; WIDE's op-root was hydrated
    // pointing at it — the exact present-but-incomplete state behind the composer crash.
    client.hydrate({
      ops: {[opKey(WIDE, undefined)]: {ticket: {__ref: 'Ticket:1'}}},
      entities: {'Ticket:1': {__typename: 'Ticket', id: '1'}}
    })

    // The gate must NOT hand back data — component code never gets a chance to read the hole.
    const read = client.ensure(WIDE)
    expect(read.data).toBeUndefined()
    expect(read.promise).toBeInstanceOf(Promise)
    await read.promise

    // After the corrective refetch, data is COMPLETE — the read that used to crash succeeds.
    const after = client.ensure(WIDE)
    expect(after.promise).toBeUndefined()
    const wrapped = readWrapped(client, after.data)
    expect(() => wrapped.ticket.timeline.totalCount).not.toThrow()
    expect(wrapped.ticket.timeline.totalCount).toBe(3)
  })

  it('relation ref-swap: a mutation repointing a relation to an UNDER-SELECTED entity re-suspends', async () => {
    const full = {
      ticket: {
        __typename: 'Ticket',
        id: '1',
        timeline: {totalCount: 3, __typename: 'Timeline'},
        assignee: {__typename: 'User', id: '9', name: 'Ada'}
      }
    }
    const fetcher = vi.fn(async () => ({data: full}))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})

    // Initial complete load → satisfied → the read works.
    await client.fetch(WIDE)
    const first = client.ensure(WIDE)
    expect(first.promise).toBeUndefined()
    expect(readWrapped(client, first.data).ticket.assignee.name).toBe('Ada')

    // A mutation swaps `assignee` to User:12 but selected only its `id` (not `name`) —
    // refs replace wholesale, so Ticket:1.assignee now points at an under-selected entity.
    client.store.mergeEntities({
      'Ticket:1': {__typename: 'Ticket', id: '1', assignee: {__ref: 'User:12'}},
      'User:12': {__typename: 'User', id: '12'}
    })

    // Re-evaluated against the CURRENT store, WIDE is no longer satisfied (User:12.name is
    // absent) → the gate suspends rather than letting `assignee.name` read as a hole.
    const second = client.ensure(WIDE)
    expect(second.data).toBeUndefined()
    expect(second.promise).toBeInstanceOf(Promise)
  })

  it('the common case stays flash-free: a scalar-updating mutation on a shared entity updates readers WITHOUT suspending', async () => {
    const full = {
      ticket: {
        __typename: 'Ticket',
        id: '1',
        timeline: {totalCount: 3, __typename: 'Timeline'},
        assignee: {__typename: 'User', id: '9', name: 'Ada'}
      }
    }
    const fetcher = vi.fn(async () => ({data: full}))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})
    await client.fetch(WIDE)

    // A normal mutation writes updated SCALARS of a shared entity (here: assignee's name).
    // Non-destructive merge keeps every other field → the op stays complete.
    client.store.mergeEntities({'User:9': {__typename: 'User', id: '9', name: 'Ada Lovelace'}})

    const read = client.ensure(WIDE)
    expect(read.promise).toBeUndefined() // satisfied → no suspense flash
    expect(readWrapped(client, read.data).ticket.assignee.name).toBe('Ada Lovelace')
    expect(fetcher).toHaveBeenCalledTimes(1) // served from cache, no refetch
  })

  it('feature-gated null is NOT a hole: a present-but-null nullable field serves without suspending', async () => {
    // `assignee: null` is a real answer (unassigned / gated). The op is complete.
    const fetcher = vi.fn(async () => ({
      data: {
        ticket: {
          __typename: 'Ticket',
          id: '1',
          timeline: {totalCount: 0, __typename: 'Timeline'},
          assignee: null
        }
      }
    }))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})
    await client.fetch(WIDE)

    const read = client.ensure(WIDE)
    expect(read.promise).toBeUndefined()
    const wrapped = readWrapped(client, read.data)
    expect(wrapped.ticket.assignee).toBeNull()
    expect(wrapped.ticket.assignee?.name).toBeUndefined() // guardable, no throw
    expect(fetcher).toHaveBeenCalledTimes(1) // complete → no re-suspend
  })

  it('boundary of the guarantee: a spec-violating server (selected field OMITTED) is the ONLY leak, and only past the one-shot backstop', async () => {
    // A compliant GraphQL server returns every selected field (null if the resolver
    // returned null). If a broken server OMITS `timeline` from its response entirely, the
    // gate refetches ONCE; if that still doesn't fill it, the backstop serves the data we
    // have rather than suspend forever. This documents the single, honest boundary of
    // "structurally impossible" — everything a compliant server + the cache can produce is
    // caught; only a protocol violation can slip through, and even then bounded.
    const broken = {ticket: {__typename: 'Ticket', id: '1', assignee: null}} // no `timeline`
    const fetcher = vi.fn(async () => ({data: broken}))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})

    // #1 — genuine miss → fetch. The response omits `timeline`, so the data is incomplete.
    const first = client.ensure(WIDE)
    expect(first.promise).toBeInstanceOf(Promise)
    await first.promise

    // #2 — data present but incomplete → the gate spends its ONE completeness refetch.
    const second = client.ensure(WIDE)
    expect(second.data).toBeUndefined()
    expect(second.promise).toBeInstanceOf(Promise)
    await second.promise

    // #3 — still incomplete AND the backstop is spent → serve what we have (no infinite loop).
    const third = client.ensure(WIDE)
    expect(third.data).toBeDefined()
    expect(fetcher).toHaveBeenCalledTimes(2) // initial + one completeness refetch, then stop

    // Reading the omitted non-null field IS still a hole here — a broken server is out of the
    // cache's control. This is the single boundary, asserted so it can't regress silently.
    const wrapped = readWrapped(client, third.data)
    expect(() => wrapped.ticket.timeline.totalCount).toThrow()
  })
})
