---
'@getcronit/pylon': patch
---

Stop the queues battery importing the core logger across a feature boundary.

`src/queues/{outbox,queue}.ts` reached the logger via a relative `../core/logger.js`. The
build is transpile-only, so a relative import across a feature boundary INLINES that module
into the importing feature's bundle — meaning the queues battery would carry a second logger
instance with its own async context and configuration, rather than sharing the one the rest of
the runtime uses. Both now use the `@getcronit/pylon` self-ref, which the build keeps external.

`renderLine` and `jobLogLevel` are exported from core to make that possible: they are what the
BullMQ per-job log tee needs. Exporting them was the deliberate choice over adding the pair to
`allowsRelative` in `scripts/check-boundaries.mjs`, since inlining a logger is exactly what the
check exists to prevent.

This also unbreaks `pnpm --filter @getcronit/pylon typecheck`, which runs the boundary check
before `tsc` and so had been failing outright.
