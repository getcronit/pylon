import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
// Importing the package entry enables `@app.queue()` — no separate import.
import {Queue, enqueuer, queue, getQueueDefinition, queuesOf, type JobContext} from '../src/index'

describe('app.queue() — queue classes that extend Queue', () => {
  it('registers a Queue subclass, namespaced by the app, tracked for harvest', () => {
    const blog = new Pylon({name: 'blog'})

    @blog.queue({attempts: 3})
    class Publish extends Queue<{postId: string}> {
      static jobs = enqueuer(Publish)
      async process({data}: JobContext<{postId: string}>) {
        void data.postId
      }
    }

    expect(getQueueDefinition(Publish).name).toBe('blog:publish')
    expect(queuesOf(blog).map(q => q.name)).toContain('blog:publish')
    // the enqueue manager is wired (typed add/dispatch)
    expect(typeof Publish.jobs.dispatch).toBe('function')
    expect(typeof Publish.jobs.add).toBe('function')
  })

  it('kebab-cases the class name', () => {
    const shop = new Pylon({name: 'shop'})

    @shop.queue()
    class SendInvoice extends Queue<{id: string}> {
      static jobs = enqueuer(SendInvoice)
      async process() {}
    }

    expect(getQueueDefinition(SendInvoice).name).toBe('shop:send-invoice')
  })

  it('a payload-less queue on an un-named app stays unprefixed', () => {
    const anon = new Pylon()

    @anon.queue()
    class Ping extends Queue {
      async process() {}
    }

    expect(getQueueDefinition(Ping).name).toBe('ping')
  })

  it('the free queue() decorator works without an app', () => {
    @queue({name: 'reindex'})
    class Reindex extends Queue<{table: string}> {
      static jobs = enqueuer(Reindex)
      async process({data}: JobContext<{table: string}>) {
        void data.table
      }
    }

    expect(getQueueDefinition(Reindex).name).toBe('reindex')
  })
})
