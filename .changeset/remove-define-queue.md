---
'@getcronit/pylon': minor
---

Remove the legacy functional `defineQueue` from `@getcronit/pylon/queues`.

The class form is the queue authoring API:

```ts
import {Queue, manager} from '@getcronit/pylon/queues'
import {z} from 'zod'

export class SendEmail extends Queue.input(z.object({to: z.string().email()})) {
  static jobs = manager(SendEmail)
  async process({data, job, log}) {
    /* … */
  }
}
```

`cron(name, pattern, handler)` is unchanged for scheduled jobs. Migrate any
`defineQueue('name', opts).process(handler)` to a `class extends Queue` with
`static jobs = manager(...)`.
