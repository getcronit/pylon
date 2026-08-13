import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Queue,
  manager,
  getQueueDefinition,
  queuesOf,
  type JobContext,
  type QueueConfig
} from '@/queues/index'

describe('new Pylon({queues}) — decorator-free queue registration', () => {
  // Plain queue classes — no decorator, no app import. Per-queue options in static config.
  class Publish extends Queue<{postId: string}> {
    static config = {attempts: 3} satisfies QueueConfig<Publish>
    static jobs = manager(Publish)
    async process({data}: JobContext<{postId: string}>) {
      void data.postId
    }
  }
  class Digest extends Queue {
    async process() {}
  }

  // The app owns them via the constructor.
  const news = new Pylon({name: 'news', queues: [Publish, Digest]})

  it('registers each queue, namespaced by the app, recorded privately', () => {
    expect(getQueueDefinition(Publish).name).toBe('news.publish')
    expect(getQueueDefinition(Digest).name).toBe('news.digest')
    expect(queuesOf(news).map(q => q.name).sort()).toEqual(['news.digest', 'news.publish'])
    // the enqueue manager is wired (typed add/dispatch)
    expect(typeof Publish.jobs.dispatch).toBe('function')
    expect(typeof Publish.jobs.add).toBe('function')
  })

  it('per-queue options come from static config (attempts)', () => {
    expect(getQueueDefinition(Publish).describe().attempts).toBe(3)
  })

  it('an un-named app leaves queue names unprefixed', () => {
    class Sweep extends Queue {
      async process() {}
    }
    new Pylon({queues: [Sweep]})
    expect(getQueueDefinition(Sweep).name).toBe('sweep')
  })
})
