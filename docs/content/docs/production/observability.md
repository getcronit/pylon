---
title: Observability
nav: Observability
description: Error and performance monitoring at the GraphQL layer, plus structured logs from resolvers and jobs.
section: Production
order: 2
---

Pylon instruments the **GraphQL layer** directly. Add the `useSentry` plugin and
every operation gets a performance span, every resolver exception is captured with
full context, and returned errors carry a `sentryEventId` so a user-facing error
maps straight to a trace in your dashboard.

## Wire up Sentry

Add `useSentry` to your plugins and pass a DSN from the environment. The plugin
hooks the execution pipeline — no per-resolver instrumentation required:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useSentry} from '@getcronit/pylon'

export default {
  plugins: [
    useSentry({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV
    })
  ]
} satisfies PylonConfig
```

```bash
SENTRY_DSN=https://…@o0.ingest.sentry.io/0 node .pylon/server.mjs
```

That's the whole setup. With the DSN present the plugin activates; without it, it's
a no-op, so the same config is safe in development.

## What it captures

For every GraphQL operation, `useSentry`:

- **Opens a span** per operation, so you see latency per query and mutation.
- **Tags** the span with the operation name and type (`query` / `mutation` /
  `subscription`), making it easy to group and alert.
- **Captures resolver exceptions** to Sentry with the operation context attached —
  the failing field, the arguments, and the principal where available.
- **Stamps `sentryEventId`** onto the returned GraphQL error's `extensions`, so the
  error a client sees links directly to the captured event:

```json
{
  "errors": [
    {
      "message": "Internal server error",
      "extensions": {"code": "INTERNAL_SERVER_ERROR", "sentryEventId": "a1b2c3d4"}
    }
  ]
}
```

:::tip
Surface `sentryEventId` in your frontend's error UI. A support request that quotes
the event id lets you jump to the exact trace — request, operation, and stack — in
one click.
:::

## Structured logging

Beyond exception capture, two streams of structured logs are always available:

- **Job logs.** A queue processor's `log()` helper writes structured, timestamped
  entries attached to the job, so you can trace a background job's progress and
  retries — see [background jobs](/docs/queues/overview).

  ```ts
  reportQueue.process(async ({data, job, log}) => {
    await log(`building report for ${data.month}`)
    // ...
  })
  ```

- **Resolver errors in development.** When you run `pylon dev`, thrown resolver
  errors print to the console with the operation and stack, so you see failures
  immediately without leaving the terminal.

:::note
Distinguish *expected* from *unexpected* errors. Domain errors like
`ForbiddenError` and `NotFoundError` carry their own GraphQL codes and HTTP
statuses and are part of your API contract — Sentry captures the unexpected ones,
the genuine `500`s, so your dashboard stays signal, not noise.
:::
