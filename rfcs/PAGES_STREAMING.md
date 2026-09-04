# RFC: usePages streaming — `loading.tsx` boundaries + progressive SSR

Status: **Implemented**. Scope: a `loading.tsx` file convention that creates framework-managed
`<Suspense>` boundaries per route segment, and progressive streaming on top of it — driven purely by
boundary presence (no opt-in flag), without regressing the response-status correctness
(`notFound()`/`redirect()`/`forbidden()`) that the buffered model guarantees. Related:
[SSR request context](./SSR_REQUEST_CONTEXT.md),
[SSR i18n](./SSR_I18N.md).

## Status: implemented (what shipped)

- **`loading.tsx` convention** — a fifth file convention (`getLoadingComponentName` + `detect('loading.tsx', …)`
  in `app-utils.ts`), cascading like `error.tsx`/`not-found.tsx` via a threaded `inheritedLoading`. The
  segment's leaf **page** is wrapped in `withLoading(…)` (a `<Suspense fallback>`), and the resolved loading
  component is also the route's `HydrateFallback`.
- **Always-on streaming send path** (`setup/index.tsx`) — prod always uses `renderToReadableStream` and
  flushes the shell at shell-ready. **No flag, no gating.** With no boundary (no `loading.tsx` *and* no manual
  `<Suspense>`), the shell is the whole document, so it degenerates to the buffered result — no behavioral
  difference. `withLoading` is therefore active on both server and client (no client-only mode split — an
  earlier draft's workaround, removed).
- **Response-status correctness preserved where it can be.** With no boundary, any throw is a *shell* error:
  `renderToReadableStream` rejects before a byte flushes, and the handler falls through to the **buffered
  path**, whose re-render draws the `errorElement` server-side with the right status. So `notFound()`/status/
  containment are unchanged for no-boundary routes and for throws *above* a boundary (in the shell) or in a
  loader.
- **The scoped tradeoff.** A `useData` failure or `notFound()` *below* a flushed boundary can no longer set
  the status (stays 200) or be contained server-side — React aborts that boundary and the client re-renders
  it (React Router's `errorElement` contains it client-side). This is inherent, not a workaround: see
  "Why loaders can't remove it" below.
- **Cache handoff.** The pre-render half (`context`/`i18n`/`messages`) rides React's `bootstrapScriptContent`.
  The post-render `cache` (the pylon-query store snapshot) is appended by a `TransformStream.flush()` at
  stream-end (== React `allReady` == store complete) — the streaming-safe equivalent of the buffered path's
  `</body>` splice.
- **Dev buffers** (the Vite HTML transform needs the whole document string); behavior is otherwise identical.
- Validated: `e2e/tests/loading-boundary-serve.e2e.test.ts` + `e2e/fixtures/loading-app` (9 tests: streams
  own + inherited boundaries with the fallback in the shell and resolved content on the same response;
  no-boundary routes show no fallback; generated routes wire own + inherited and skip uncovered segments;
  fallback shipped to the client bundle). Full e2e green apart from one pre-existing, unrelated `@inContext`
  failure.

### Why loaders can't remove the tradeoff

The obvious "fix" — resolve a route's data in a pre-render loader so status/errors are known before the
first byte — does **not** work for Pylon, because `useData` is co-located with components and **JSX gates
which components render** (`{isAdmin && <AuditPanel/>}`). The set of operations that actually execute is
therefore *render-determined*: you cannot enumerate it ahead of render without over-fetching (running gated-
away queries, including ones the user's auth would exclude) or already knowing the render outcome. Rendering
*is* the query-discovery mechanism (that is what the static per-`useData` documents feed: shape, not the
executed set). So a throw below a boundary is unknowable pre-flush **by construction**, and the tradeoff is a
property of the model, not of this implementation.

## What already works (verified, not assumed)

- `usePages` SSR is **fully buffered**: `renderToHtml` calls `renderToReadableStream` but immediately
  drains it — `await new Response(stream).text()`
  ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)) — then does its
  string injection, sets status/headers, and `c.html(html)`. It is *SSR that happens to use the
  streaming API*, not streaming.
- Data is fetched **in-process** during render: `useData` → `ensure()` throws a promise → Suspense →
  the request-bound `createServerFetcher` hits the mounted app directly (no network hop)
  ([client.ts](../packages/pylon/src/query/runtime/client.ts),
  [setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)). The single-pass
  Suspense model means there is no separate data-probe pass.
- The server→client hydration handoff is now **out of the reconciled tree**: `context`/`i18n`/`messages`
  ride React's `bootstrapScriptContent`, the post-render query `cache` is a trailing inline script, and
  only the hoistable `<link>`s stay in-tree. So the current output is already **streaming-safe** (no
  server-only `<script>` node for an app `<script>` to collide with during hydration). See the JSON-LD
  hydration fix in [internals.tsx](../packages/pylon/src/pages/pages/internals.tsx) and
  [setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx).
- Recognized file conventions today: `layout.tsx`, `page.tsx`, `error.tsx`, `not-found.tsx`
  ([app-utils.ts](../packages/pylon/src/pages/plugins/use-pages/build/app-utils.ts)). **There is no
  `loading.tsx`.**

## The core finding (why streaming is a no-op today)

**Pylon renders no `<Suspense>` boundary anywhere.** Not at root, not per-route. The only mentions in
the source are a doc comment in
[error-boundary.tsx](../packages/pylon/src/pages/pages/error-boundary.tsx) that tells *users* to add
their own, and a dead `Suspense` import in the generated app code
([app-utils.ts](../packages/pylon/src/pages/plugins/use-pages/build/app-utils.ts)). `HydrateFallback`
is a React Router *client-hydration* concept, not a server boundary.

Two consequences follow, and they are the spine of this RFC:

1. **No boundary ⇒ everything is the shell ⇒ nothing to stream.** `useData` suspends (throws a promise).
   With no `<Suspense>` above it, that suspension propagates to the root, so the *shell itself* is
   pending and `renderToReadableStream` cannot emit until every `useData` settles. Deleting the
   `.text()` buffer would change nothing — there are no independent flush points. **Progressive
   streaming is inert until a boundary exists.**

2. **No boundary ⇒ status-affecting throws are always shell errors ⇒ correct status.** `notFound()`
   throws a real `Response(404)` synchronously during render
   ([http.ts](../packages/pylon/src/pages/pages/http.ts)). Because the throw happens with the shell
   still pending (no boundary flushed), it rejects `renderToReadableStream` / hits `onShellError`, the
   handler catches it ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)),
   populates `context.errors`, sets `context.statusCode`, re-renders the error boundary, and sends the
   right status. This is *structural*, not a side effect of buffering, and the error-boundary design
   leans on it deliberately (React 19 cannot server-render an inline Suspense fallback anyway).

So the "post-flush `notFound()` → 200 with 404 UI" hazard is **doubly unreachable today**: it needs both
(a) real streaming and (b) a boundary for the throw to sit behind. This RFC introduces exactly those two
things, so **it must introduce the hazard's mitigation in the same stroke.**

## Motivation

`loading.tsx` is worth adding on its own merits, independent of streaming:

1. **Framework-managed loading UI, cascading like `error.tsx`.** Today an author must hand-place
   `<Suspense fallback={…}>` and know where. A `loading.tsx` per segment is the ergonomic parity move
   (Next's `loading.tsx`, Remix's `HydrateFallback`), and it composes with the existing
   `error.tsx`/`not-found.tsx` cascade.
2. **It is the enabler for streaming.** A per-segment boundary is precisely the independent flush point
   the shell lacks. Once segments have boundaries, progressive streaming becomes *possible* — flush the
   shell (chrome + fast data) immediately, stream slow segments as their data resolves.
3. **Better perceived performance for genuinely slow, independent regions** — a dashboard with a fast
   header and a slow report, say — without blocking first paint on the slow region.

The honest caveat: streaming's benefit is *smaller for Pylon* than for network-fetch frameworks, because
`useData` is in-process. So the send-path swap that activates server streaming (Phase 4) is
**evidence-gated**, and `loading.tsx` is valuable **even before then** (it gives client-navigation loading
states and author-declared boundaries with the send path still buffered).

## Proposal

### Part A — `loading.tsx` file convention

Add `loading.tsx` as a fifth recognized convention alongside `layout/page/error/not-found`
([app-utils.ts](../packages/pylon/src/pages/plugins/use-pages/build/app-utils.ts)):

- A segment's `loading.tsx` default export wraps that segment's element in
  `<Suspense fallback={<Loading/>}>`, generated in `buildRouteElement`/`generateRouteFileContent`
  next to where `errorElement` is already built.
- **Cascade** like `error.tsx`/`not-found.tsx`: a segment inherits the nearest ancestor `loading.tsx`
  unless it defines its own.
- Wire it to React Router as the route's `HydrateFallback` too, so client-side lazy/hydration reuse the
  same component instead of the hard-coded `<div>Loading...</div>`
  ([app-utils.ts](../packages/pylon/src/pages/plugins/use-pages/build/app-utils.ts)).
- **Until the send-path swap (Phase 4), semantics are unchanged**: with the `.text()` drain still in
  place, the boundary resolves before send, so `loading.tsx` never appears in the SSR HTML — it only shows
  during *client* navigation. This ships Part A with zero risk to the status guarantees; server streaming
  begins only when Phase 4 replaces `.text()` (Part B).

### Part B — streaming is `loading.tsx` presence; there is no separate switch

Streaming does **not** need an opt-in flag. Defining a `loading.tsx` *is* the opt-in; not defining one is
the opt-out — because the boundary is the only thing that can flush independently. This falls out of a
**single uniform send strategy**: pipe `renderToReadableStream` to the response and send the shell as soon
as it is ready, streaming each boundary as its data resolves. That one path degenerates to buffered
automatically:

- **No `loading.tsx` anywhere** → no Suspense boundary → every `useData` suspension lives *in the shell* →
  the shell is not "ready" until everything resolves → "send shell when ready" **is** "send the whole
  document." Byte-for-byte today's buffered behavior, and a `notFound()` is a shell error → real 404. No
  special-casing required.
- **`loading.tsx` on a segment** → that segment's suspension is caught by its boundary → the shell
  (everything above it) is ready early and flushes; the segment streams in behind it.

So there are not two modes to gate — there is one send-path that *is* buffered wherever there are no
boundaries. A global `stream` switch (an earlier draft) is therefore redundant with "did you write a
`loading.tsx`," and a per-route flag is redundant with *where* you wrote it. Neither is proposed.

Consequence to accept: `loading.tsx` couples its two jobs — **client-navigation fallback** and
**server-stream flush boundary**. You cannot get "nav spinner but never stream on first load." That is
fine, because **placement is the control** (Part C): a segment that must return a real status either isn't
wrapped in `loading.tsx`, or throws from its loader (pre-flush). The boundary is simultaneously the
streaming enabler and the "I accept this flushes after the shell" declaration — one act, one mental model.
Crucially, this means the header/status-commit work (blockers 2/3) does **not** touch the default:
buffered semantics survive for free for everything not behind a boundary.

### Part C — the non-negotiable constraint: response-status correctness

Streaming commits the status line + headers with the first byte. So a status-affecting throw
(`notFound`/`redirect`/`forbidden`) discovered *after the shell flushes* (i.e. inside a streamed
boundary) can render the right UI but **cannot set the status** — it stays 200. This RFC treats
preserving status correctness as a first-class requirement, not an afterthought. The design rule:

> On a streamed route, a status-affecting decision must be reachable **before the shell flushes** — from
> a **loader** (which already runs pre-render, `routeHandler.query`,
> [setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)) or from a component
> **in the shell** (above the first `loading.tsx`). A `notFound()` behind a `loading.tsx` boundary
> yields correct UI but a 200.

Two escapes, and both are just *where you put the boundary*:

1. **Don't wrap it** — a segment with no `loading.tsx` above it stays in the shell, so its `notFound()` is
   a shell error with correct status. (No boundary = buffered = full status, automatically — Part B.)
2. **Loader-resolved existence/authz** — throw `notFound()`/`forbidden()`/`redirect()` from the loader,
   which runs pre-render → real status even for a segment behind a boundary. (Requires surfacing loaders in
   the `loading.tsx` ergonomic; today data lives in `useData`.)

There is no per-route "buffer this one anyway" knob because it is unnecessary: not placing a boundary is
that knob. Dev-time guard: warn when a `notFound()`/`redirect()` is observed *after* first flush (i.e.
thrown below a boundary), pointing at these two escapes.

## Blockers (dependency order) and their fixes

1. **Buffered-by-construction `.text()`** — the master switch
   ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)). *Fix:* replace it
   with the uniform stream-pipe (send shell when ready). No separate buffered path — it degenerates to
   buffered wherever there are no boundaries (Part B).
2. **Status/headers/cookies decided after render** — `context.statusCode`, `Vary`, `flushCookies()`
   applied post-render ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)).
   *Fix (the hard one):* move these decisions pre-flush; components can no longer change headers on a
   streamed route. This is Part C.
3. **Error/redirect recovery re-renders the whole tree** — the catch block populates `context.errors`
   and renders again ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)).
   A second full render is impossible once the shell has flushed. *Fix:* rely on React streaming's
   `onShellError` (pre-flush) + streamed `errorElement` in place (post-flush). The re-render still works
   for the no-boundary case, since there the shell is the whole document and nothing has flushed.
4. **Monolithic `pagesClient.collect()`** — a whole-store snapshot with no delta cursor
   ([client.ts](../packages/pylon/src/query/runtime/client.ts),
   [store.ts](../packages/pylon/src/query/runtime/store.ts) — note the store has a `version` counter
   that could seed one). *Fix:* emit per-boundary `cache` deltas as boundaries resolve, merged onto
   `window.__pylonStaticData.cache` (additive; the client hydrate already merges). Most tractable.
5. **`devBridge.transformHtml` on the full string**
   ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)). *Fix:* make the
   dev transform stream-aware, or keep the `.text()` drain in dev (it degenerates identically).

## Phased plan

- **Phase 1 — `loading.tsx`, buffered. ✅ LANDED.** Added the convention + cascade + `HydrateFallback`
  wiring in `app-utils.ts` (`getLoadingComponentName`, `detect('loading.tsx', …)`, threaded
  `inheritedLoading`). The segment's leaf **page** is wrapped in a **client-only** `withLoading(…)`
  Suspense (server renders the component directly so the `useData` suspension escalates to the shell →
  buffered HTML carries resolved content, `notFound()` stays a real 404; the client gets the boundary for
  navigation loading). Validated by `e2e/tests/loading-boundary-serve.e2e.test.ts` + fixture
  `e2e/fixtures/loading-app` (8 tests: SSR fallback-absent on own/inherited/none segments; generated
  routes wire own + inherited and skip un-covered segments; fallback shipped to the client bundle). Full
  e2e 326/326.
  **Known Phase-1 limitation:** only the leaf page is wrapped, so a **layout** that itself suspends on
  `useData` has no local boundary (its suspension escalates as before). Layout-level `loading.tsx`
  coverage is deferred — pages are where `useData` overwhelmingly lives.
- **Phase 2 — pre-flush response discipline.** Move status/redirect/cookie decisions to loaders / shell;
  document the rule; add the dev-time post-flush-throw warning. No behavior change yet (still `.text()`).
- **Phase 3 — per-boundary cache emission.** Delta snapshots keyed off the store `version`, emitted on
  boundary resolve.
- **Phase 4 — swap the send path.** Replace `.text()` with the uniform stream-pipe (send shell when ready)
  + `onShellError`/`onError`; make the dev transform stream-aware. There is no flag: the swap itself turns
  streaming on everywhere a `loading.tsx` boundary exists, and degenerates to buffered everywhere else.
  **Rollout caveat:** this is the point where any `loading.tsx` added in Phase 1 (for client-nav) begins
  server-streaming and inherits the Part C status rule — so Phase 4 is a deliberate, documented,
  evidence-gated release, with the dev warning from Phase 2 already in place to surface post-flush throws.

## Open questions

- **Opt-in surface (resolved): none.** Both a per-route flag and a global `stream` switch were considered
  and rejected as redundant. `loading.tsx` presence *is* the opt-in and its absence *is* the opt-out,
  because a single uniform send-path degenerates to buffered wherever there are no boundaries (Part B). The
  only knob that could still earn its place is a "client-nav fallback without server streaming" mode — not
  proposed now; add it only if a concrete need appears.
- **`loading.tsx` before the send-path swap (Phase 1–3).** Confirm it never leaks into SSR HTML (boundary
  resolves before send under `.text()`) and only affects client navigation — write an e2e that asserts the
  fallback is absent from the server HTML but present mid client-navigation.
- **Interaction with per-route error containment.** The current design localizes a failed `useData` to
  the shallowest failed route's `errorElement`
  ([setup/index.tsx](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)). Under streaming,
  a failure below the flush line becomes a streamed `errorElement` (200). Confirm the owner-tagging
  (`failedOwners`) still attributes correctly across the flush boundary.
- **Is Phase 2+ worth it?** Requires a concrete real-app page with slow, *independent* data regions
  where shell TTFB measurably matters. Phase 1 is justified on its own; Phases 2–4 need that evidence.

## Recommendation

Ship **Phase 1 (`loading.tsx`, still buffered via `.text()`) now** — it is the ergonomic gap, it is
low-risk, and it is the prerequisite for everything else. Treat **Phases 2–4 (the send-path swap that
turns boundaries into server streaming) as evidence-gated**: build them when a real page demonstrates the
need, starting from "preserve response-status correctness" (Part C). There is no streaming flag —
`loading.tsx` presence is the opt-in, its absence the opt-out — so until an app places a boundary *and*
Phase 4 lands, a `notFound()` stays a real 404 from anywhere.
