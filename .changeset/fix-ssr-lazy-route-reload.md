---
'@getcronit/pylon': patch
---

Fix intermittent dev-server failures: "window is not defined" SSR crashes and HMR
cross-wiring between concurrent dev servers.

**"window is not defined" during SSR.** Every page's generated `lazy()` loader had
an unguarded `window.location.reload()` in its `import().catch(...)`. That loader
runs during SSR too (React Router's `createStaticHandler` resolves matched routes'
`lazy()` on the server), so when a route chunk momentarily failed to import it ran
`window.location.reload()` in Node and threw `ReferenceError: window is not
defined`, masking the real error and tripping the route error boundary into a
hydration mismatch and full reload. The catch now guards the reload behind
`typeof window !== 'undefined'` (returning a never-resolving promise so the client
doesn't then crash on `i.default`) and rethrows on the server.

**The rebuild race that triggered it.** `rebuild()` removed the pages output dir
*before* rewriting it, so an SSR request landing mid-rebuild imported a deleted
chunk. In dev that up-front clean is now skipped — output files are content-hashed
and coexist with the old ones, and the manifest is swapped atomically, so a rebuild
never deletes a chunk a live request needs; stale generations are swept *after* the
new bundle is in place, and only once untouched for a grace window, so `.pylon`
doesn't grow unbounded and no in-flight request loses a chunk. Production still
cleans up front as before.
`reloadServer` also now reloads the in-memory pages manifest after a schema-driven
pages rebuild (as `reloadPages` already did), so SSR never points at a stale hash.

**HMR port collision.** In middleware mode Vite opened its HMR websocket on its
fixed default port (24678). Two pylon dev servers fought over it: the loser
couldn't bind, and its browser silently connected to the winner's HMR socket,
cross-wiring updates between apps (stray reloads, hydration errors). HMR now runs
over the app's own http server (shared origin + port), so each dev server has its
own channel and they can never collide.

**SSR/client rebuild latch.** Vite serves an edited module to the browser
on-demand immediately, while the SSR bundle is a rolldown artifact rebuilt
asynchronously — so a full reload landing between the two rendered stale SSR HTML
against fresh client code (a hydration mismatch). The dev supervisor now latches
the SSR handler the moment a source file changes and releases it once the ensuing
rebuild + manifest reload finish, so a reload during an edit always renders the
same bundle the client loads. The rebuild is debounced instead of gated on
`awaitWriteFinish` so the latch can fire on the first event; a safety timeout keeps
a missed release from ever wedging dev SSR. No-op in production.
