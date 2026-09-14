import {describe, it, expect} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {Queue, manager, getQueueDefinition, type JobContext, type QueueConfig} from '@/queues/index'

// A structural `{parse}` schema (zod fits this shape; no zod dep needed for the test).
const PostInput = {
  parse(input: unknown): {postId: string} {
    if (typeof (input as any)?.postId !== 'string') throw new Error('invalid payload')
    return input as {postId: string}
  }
}

describe('Queue.input(schema) — schema-first payloads', () => {
  it('infers the payload type from the schema and validates at runtime', async () => {
    class Publish extends Queue.input(PostInput) {
      static config = {attempts: 3} satisfies QueueConfig<Publish>
      static jobs = manager(Publish)
      async process({data}: JobContext<{postId: string}>) {
        // `data` is typed {postId: string}, inferred from the schema (single source).
        void data.postId
      }
    }
    new Pylon({name: 'blog', queues: [Publish]})

    expect(getQueueDefinition(Publish).name).toBe('blog.publish')

    // Runtime validation runs at enqueue, BEFORE Redis — a bad payload is rejected
    // even with no broker running (the guarantee the erased generic can't give).
    await expect(Publish.jobs.add({nope: 1} as any)).rejects.toThrow('invalid payload')
  })

  it('an explicit static config {schema} still wins over the attached one', async () => {
    const strict = {
      parse(i: unknown): {id: string} {
        if (!(i as any)?.id) throw new Error('option schema rejected')
        return i as {id: string}
      }
    }

    class Reindex extends Queue.input(PostInput) {
      static config = {schema: strict}
      static jobs = manager(Reindex)
      async process() {}
    }
    new Pylon({name: 'svc', queues: [Reindex]})

    await expect(Reindex.jobs.add({postId: 'x'} as any)).rejects.toThrow('option schema rejected')
  })
})
