/**
 * hasManyThrough (Rails' `has_many :through`) against a real Postgres. A Ticket
 * reaches GRANDCHILDREN over two existing relations:
 *   Ticket ──messages──▶ TicketMessage ──comments──▶  Comment   (via = hasMany)
 *   Ticket ──messages──▶ TicketMessage ──attachments▶ Asset     (via = manyToMany)
 * No denormalized `ticketId` on Comment/Asset — the chain walks the FKs that
 * already exist. Asserts:
 *  - count/all/paginate correctness (incl. zero, dedup across a ticket's messages,
 *    and the `where:{deleted:false}` scope excluding soft-deleted assets),
 *  - REAL batching: N tickets in one microtask → a handful of queries, not O(N),
 *  - the connection is LAZY — reading only `totalCount` never runs the per-ticket
 *    page query (which is what lets the list badge batch),
 *  - Relay windowing (first/after and last/before) over the chain.
 */
import pg from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  boolean,
  connect,
  Database,
  foreignKey,
  hasMany,
  hasManyThrough,
  id,
  int,
  manyToMany,
  manager,
  Model,
  type ModelConfig,
  type Relation,
  runAsSystem,
  syncSchema,
  text
} from '@/db/index'

class Ticket extends Model {
  static config = {table: 'hmt_ticket'} satisfies ModelConfig<Ticket>
  static objects = manager(Ticket)
  id = id()
  title = text()
  messages = hasMany(() => TicketMessage, {foreignKey: 'ticketId'})
  // via = hasMany (Comment.ticketMessageId → TicketMessage). `foreignKey` omitted →
  // auto-detected from TicketMessage's sole belongsTo → Ticket.
  comments = hasManyThrough(() => Comment, {
    through: () => TicketMessage,
    via: 'comments',
    orderBy: 'seq',
    paginate: true
  })
  // via = manyToMany (TicketMessage.attachments) + a scope that hides soft-deleted.
  // Explicit `foreignKey` here to also cover that path.
  attachments = hasManyThrough(() => Asset, {
    through: () => TicketMessage,
    foreignKey: 'ticketId',
    via: 'attachments',
    where: {deleted: false},
    orderBy: 'seq',
    paginate: true
  })
}
new Pylon({db: {models: [Ticket]}})

class TicketMessage extends Model {
  static config = {table: 'hmt_ticket_message'} satisfies ModelConfig<TicketMessage>
  static objects = manager(TicketMessage)
  id = id()
  ticketId = foreignKey(() => Ticket)
  declare ticket: Relation<Ticket>
  comments = hasMany(() => Comment, {foreignKey: 'ticketMessageId', orderBy: 'seq'})
  attachments = manyToMany(() => Asset)
}
new Pylon({db: {models: [TicketMessage]}})

class Comment extends Model {
  static config = {table: 'hmt_comment'} satisfies ModelConfig<Comment>
  static objects = manager(Comment)
  id = id()
  ticketMessageId = foreignKey(() => TicketMessage)
  body = text()
  seq = int() // deterministic ordering
}
new Pylon({db: {models: [Comment]}})

class Asset extends Model {
  static config = {table: 'hmt_asset'} satisfies ModelConfig<Asset>
  static objects = manager(Asset)
  id = id()
  name = text()
  seq = int()
  deleted = boolean({default: false})
}
new Pylon({db: {models: [Asset]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// Query counter (patched before connect so the pool's clients are wrapped).
let queries = 0
const origQuery = (pg as any).Client.prototype.query
;(pg as any).Client.prototype.query = function (...a: any[]) {
  queries++
  return origQuery.apply(this, a)
}

describe.skipIf(!runDb)('hasManyThrough (Postgres)', () => {
  let db: Database
  const t: Record<string, number> = {}
  const fillers: number[] = []

  beforeAll(async () => {
    db = connect({connectionString})
    for (const tbl of [
      'hmt_asset_hmt_ticket_message', // m2m join (name is order-independent; drop both spellings)
      'hmt_ticket_message_hmt_asset',
      'hmt_comment',
      'hmt_asset',
      'hmt_ticket_message',
      'hmt_ticket'
    ]) {
      await db.kysely.schema.dropTable(tbl).ifExists().cascade().execute()
    }
    await syncSchema()

    await runAsSystem(async () => {
      // ── T1: 2 messages; m1 → 2 comments, m2 → 1 comment (3 total).
      //   Assets: a1 on BOTH m1 & m2 (dedup → once), a2 on m2, a3 on m1 but DELETED.
      //   → attachments(deleted:false) distinct = {a1, a2} = 2.
      const t1 = await Ticket.objects.create({title: 'T1'})
      t.t1 = t1.id
      const m1 = await TicketMessage.objects.create({ticketId: t1.id})
      const m2 = await TicketMessage.objects.create({ticketId: t1.id})
      await Comment.objects.create({ticketMessageId: m1.id, body: 'c1', seq: 1})
      await Comment.objects.create({ticketMessageId: m1.id, body: 'c2', seq: 2})
      await Comment.objects.create({ticketMessageId: m2.id, body: 'c3', seq: 3})
      const a1 = await Asset.objects.create({name: 'a1', seq: 1})
      const a2 = await Asset.objects.create({name: 'a2', seq: 2})
      const a3 = await Asset.objects.create({name: 'a3', seq: 3, deleted: true})
      await m1.attachments.add(a1, a3)
      await m2.attachments.add(a1, a2) // a1 shared → the dedup case

      // ── T2: 1 message, 0 comments, 1 (live) asset.
      const t2 = await Ticket.objects.create({title: 'T2'})
      t.t2 = t2.id
      const m3 = await TicketMessage.objects.create({ticketId: t2.id})
      const a4 = await Asset.objects.create({name: 'a4', seq: 1})
      await m3.attachments.add(a4)

      // ── T3: no messages at all → empty on both chains.
      const t3 = await Ticket.objects.create({title: 'T3'})
      t.t3 = t3.id

      // ── 50 fillers: 1 message, 1 comment, 1 asset each — for the O(1) batch proof.
      for (let i = 0; i < 50; i++) {
        const tf = await Ticket.objects.create({title: `F${i}`})
        fillers.push(tf.id)
        const mf = await TicketMessage.objects.create({ticketId: tf.id})
        await Comment.objects.create({ticketMessageId: mf.id, body: `fc${i}`, seq: 1})
        const af = await Asset.objects.create({name: `fa${i}`, seq: 1})
        await mf.attachments.add(af)
      }
    })
  })

  afterAll(async () => {
    await db?.destroy?.()
  })

  const ticket = (id: number) => Ticket.objects.get({id})

  it('count() is correct across both via kinds (incl. zero + dedup + where-scope)', async () => {
    await runAsSystem(async () => {
      const [t1, t2, t3] = await Promise.all([ticket(t.t1), ticket(t.t2), ticket(t.t3)])
      const [c1, c2, c3] = await Promise.all([
        t1.comments.count(),
        t2.comments.count(),
        t3.comments.count()
      ])
      expect([c1, c2, c3]).toEqual([3, 0, 0])
      const [a1, a2, a3] = await Promise.all([
        t1.attachments.count(), // a1 (shared, deduped) + a2 ; a3 deleted → excluded
        t2.attachments.count(),
        t3.attachments.count()
      ])
      expect([a1, a2, a3]).toEqual([2, 1, 0])
    })
  })

  it('all() returns deduped, ordered rows (and honors the where-scope)', async () => {
    await runAsSystem(async () => {
      const t1 = await ticket(t.t1)
      const comments = await t1.comments.all()
      expect(comments.map(c => c.body)).toEqual(['c1', 'c2', 'c3']) // ordered by seq
      const assets = await t1.attachments.all()
      expect(assets.map(a => a.name).sort()).toEqual(['a1', 'a2']) // a1 once, a3 hidden
    })
  })

  it('await accessor (thenable) + first() work', async () => {
    await runAsSystem(async () => {
      const t1 = await ticket(t.t1)
      const list = await t1.comments // thenable → all()
      expect(list.length).toBe(3)
      expect((await t1.comments.first())?.body).toBe('c1')
      expect(await (await ticket(t.t3)).comments.first()).toBeNull()
    })
  })

  it('coalesces a LARGE key set into a constant query count (O(1), not O(N))', async () => {
    await runAsSystem(async () => {
      const ids = [t.t1, t.t2, t.t3, ...fillers] // 53 tickets
      const tickets = await Promise.all(ids.map(ticket))
      queries = 0
      const counts = await Promise.all(tickets.map(tk => tk.comments.count()))
      // hasMany-via count: 1 grouped bridge-id fetch + 1 grouped target count ≈ 2,
      // independent of the 53 keys. Un-batched this is ~2×53.
      expect(queries).toBeLessThanOrEqual(4)
      expect(counts[0]).toBe(3)
      expect(counts[2]).toBe(0)
      expect(counts.slice(3).every(c => c === 1)).toBe(true)
    })
  })

  it('m2m-via count also batches to a constant query count', async () => {
    await runAsSystem(async () => {
      const ids = [t.t1, t.t2, t.t3, ...fillers]
      const tickets = await Promise.all(ids.map(ticket))
      queries = 0
      const counts = await Promise.all(tickets.map(tk => tk.attachments.count()))
      // bridge ids + join-table links + one scoped target load ≈ 3, key-independent.
      expect(queries).toBeLessThanOrEqual(5)
      expect(counts[0]).toBe(2)
      expect(counts[1]).toBe(1)
      expect(counts[2]).toBe(0)
      expect(counts.slice(3).every(c => c === 1)).toBe(true)
    })
  })

  it('the connection is LAZY — reading only totalCount never runs the page query', async () => {
    await runAsSystem(async () => {
      const ids = [t.t1, t.t2, t.t3, ...fillers]
      const tickets = await Promise.all(ids.map(ticket))
      queries = 0
      // Mirror the list badge: `{ tickets { comments { totalCount } } }` — build every
      // connection, read ONLY totalCount. If `nodes` weren't lazy, each ticket would run
      // its own Comment page query → O(N); the batched count keeps it O(1).
      const conns = await Promise.all(tickets.map(tk => tk.comments()))
      const totals = await Promise.all(conns.map(c => c.totalCount))
      expect(queries).toBeLessThanOrEqual(4)
      expect(totals[0]).toBe(3)
      expect(totals.slice(3).every(n => n === 1)).toBe(true)
    })
  })

  it('paginate windows the chain (first/after and last/before)', async () => {
    await runAsSystem(async () => {
      // The connection is LAZY: `nodes`/`edges`/`pageInfo`/`totalCount` are awaited
      // getters (GraphQL awaits them; a count-only selection never runs the page
      // fetch). Programmatic callers await the field, or use `.all()`/`.count()`.
      const t1 = await ticket(t.t1)
      const page1 = await t1.comments(2) // first: 2
      expect((await page1.nodes).map((c: Comment) => c.body)).toEqual(['c1', 'c2'])
      const pi1 = await page1.pageInfo
      expect(pi1.hasNextPage).toBe(true)
      const page2 = await t1.comments(2, pi1.endCursor!) // first:2 after
      expect((await page2.nodes).map((c: Comment) => c.body)).toEqual(['c3'])
      expect((await page2.pageInfo).hasNextPage).toBe(false)
      // backward: last 1
      const last = await t1.comments(undefined, undefined, 1)
      expect((await last.nodes).map((c: Comment) => c.body)).toEqual(['c3'])
      expect(await last.totalCount).toBe(3)
    })
  })
})
