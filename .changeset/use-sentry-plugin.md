---
'@getcronit/pylon': minor
---

`useSentry` is now a public, opt-in Pylon plugin that owns the whole Sentry integration.

Previously the framework auto-installed two things unconditionally: the GraphQL-layer
Sentry envelop plugin and the `@hono/sentry` HTTP middleware. Both are now folded into a
single `useSentry()` plugin exported from `@getcronit/pylon`, and neither is installed
automatically.

**Migration:** add it to your config `plugins`, passing a DSN (without one it's a no-op,
so the same config is safe in development):

```ts
import {useSentry} from '@getcronit/pylon'

export default {
  plugins: [useSentry({dsn: process.env.SENTRY_DSN})]
} satisfies PylonConfig
```

Apps that relied on automatic Sentry wiring must add this line or they will no longer
report to Sentry. The plugin accepts the GraphQL-instrumentation options as before, plus
the `@hono/sentry` middleware options (`dsn`, `environment`, …) at the top level.
