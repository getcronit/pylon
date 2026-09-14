# RFC: Acting tenant — per-operation tenant impersonation

Status: **Framework mechanism implemented** on branch `feat/acting-tenant` (§1/§2/§4/§5);
the gate and audit (§3) are app-side policy. Scope: let a privileged principal (e.g. `SUPER_ADMIN`) run a
**single GraphQL operation** as if it were bound to a *different* tenant, so that
an admin "manage organisation" surface can reuse every ordinary tenant-scoped
resolver instead of a parallel, `unscoped()` admin API. The enabling move is to
resolve the ambient tenant/features **per operation** rather than **per HTTP
request**. Related: [SSR request context](./SSR_REQUEST_CONTEXT.md).

Do this on its own branch. Preserve behaviour: with no acting-tenant present,
every request must bind exactly as it does today.

---

## What already works (verified, not assumed)

`useDatabase` binds an **`AppContext`** — `{tenant, features, principal, debug}` —
into an `AsyncLocalStorage` for the duration of a request, and the ORM reads it via
`currentTenant()` / `currentFeatures()`:

- `AppContext` + the ALS store live in
  [`../packages/pylon/src/db/app-context.ts`](../packages/pylon/src/db/app-context.ts)
  (`runWithAppContext`, `currentTenant`, `currentFeatureState`).
- The bind happens in the plugin **middleware**, once per HTTP request, in
  [`../packages/pylon/src/db/plugin.ts`](../packages/pylon/src/db/plugin.ts):

  ```ts
  async middleware(c, next) {
    const boundPrincipal = c.get(PRINCIPAL_KEY)
    const appCtx = {
      tenant:   options.tenant ? options.tenant(c) : boundPrincipal?.tenant,
      features: await options.features?.(c),
      principal: options.principal ? options.principal(c) : boundPrincipal,
      debug: ...,
    }
    await db.run(() => runWithAppContext(appCtx, () => next()))  // wraps the WHOLE request
  }
  ```

- `UseDatabaseOptions.tenant` / `.features` / `.principal` are each
  `(context: HonoContext) => …` — i.e. **request-scoped**, deriving off the bound
  principal by default.
- The ORM's tenant filter (`applyTenantWhere`) appends
  `<target>.tenantId = currentTenant()` to every tenant-scoped read, including
  relation traversal. `.unscoped()` / `runAsSystem` are the only bypasses today.

**So the tenant is fundamentally request-scoped.** A batched GraphQL POST has one
Hono context and one `appCtx`, shared by every operation in the batch.

## Motivation

A `SUPER_ADMIN` "Organisationen" area needs to read another org's users/counts and
manage its users. Two non-solutions:

1. **Relation reads from the client** (`org.users().totalCount`) return **0** for
   every org but the admin's own, because traversal is scoped to the *viewer's*
   tenant — the FK predicate and the ambient predicate contradict.
2. **A request-wide tenant header/override** re-scopes the *entire* request — but
   the admin page renders inside the shared app shell, whose sidebar/header issue
   their own operations. Switching the request's tenant silently corrupts the
   shell (inbox, ticket/task counts, "my org").

The correct primitive is **per-operation**: only the admin surface's `useData` /
`useMutation` calls act as the target tenant; the shell's operations, in the same
request/batch, stay on the viewer's own tenant. With that in place, `currentTenant()`
= target for exactly those operations, so **every existing tenant-scoped resolver,
relation count, and `create()` (ambient `tenantId`) just works** against the acted
org — no `unscoped()`, no parallel `tenant*` resolvers.

## Design

### 1. Per-operation `AppContext` (the keystone)

Keep the per-request bind (connection via `db.run`, base `appCtx`). Add a
**per-operation** re-bind around each operation's `execute`, layered on top of the
request context. The db plugin already registers an envelop `onExecute` hook (used
today for error mapping) — that hook runs per operation and can see the operation's
params. Two viable envelop mechanisms; implementer to confirm against the pinned
`graphql-yoga`/envelop:

- **`onExecute({ setExecuteFn })`** — wrap the executor so it runs inside a fresh
  `runWithAppContext(opCtx, () => execute(args))`, or
- **`onContextBuilding`** — compute `opCtx` and stash it, then a thin execute
  wrapper enters the ALS scope.

Recommended: `setExecuteFn`, because the ALS scope must be *active during* field
resolution, not merely built before it. The DB **connection** stays request-scoped
(`db.run` outer); only the ambient `tenant`/`features` values nest per operation.
This is sound because tenant scope is a query-time `WHERE`, not a connection
property — so `transactionPerRequest` is unaffected.

```
request:  db.run( runWithAppContext(requestCtx, () => next()) )   // connection + base ctx
  op A:      runWithAppContext(opCtxA, () => execute(A))          // opCtxA = requestCtx (no acting tenant)
  op B:      runWithAppContext(opCtxB, () => execute(B))          // opCtxB = { ...requestCtx, tenant: <target>, features: <target's> }
```

### 2. Transport: a generic per-operation `context` channel on `@inContext`

Don't invent a transport, and don't make the acting tenant a compiler-known argument.
Pylon already carries per-operation context *inside the document* via the `@inContext`
directive
([`../packages/pylon/src/core/in-context.ts`](../packages/pylon/src/core/in-context.ts)) —
that's how locale reaches resolvers today (`getLocale()`), and how two locales stay in two
cache entries instead of colliding. Generalise it: add ONE opaque `context` argument that
carries an **app-typed bag**, so acting-as-tenant — and any future per-op context — never
touches the compiler again.

The value travels as a **variable**, and three things fall out for free — it is
per-operation (it lives in that op's `variableValues`; the shell's ops just don't carry a
value), it is in the client cache key (§4), and it flows identically over HTTP and through
in-process SSR (§5). A header gives none of these; a literal argument would fork the document
id per value.

Concretely:

- **SDL** (`IN_CONTEXT_SDL`): one added argument, carried as a **`String`** (JSON) —
  `directive @inContext(locale: String, context: String) on QUERY | MUTATION | SUBSCRIPTION`.
  `String` rather than a `JSON` scalar deliberately: the directive is appended to *every*
  Pylon schema, and a `JSON` scalar isn't guaranteed present — so the definition stays
  app-independent and never varies. The app's shape lives in TS, not the SDL.
- **Type** (`OperationContext`, exported from `@getcronit/pylon`): ships `{ actingTenant?: string }`
  and is app-extensible by declaration merging — **no compiler change per key**:
  ```ts
  declare module '@getcronit/pylon' { interface OperationContext { previewMode?: boolean } }
  ```
- **`InContext`** gains `context?: OperationContext`; read it via `getInContext().context`
  (kept a plain field rather than its own accessor, so it doesn't shadow the Hono
  `getContext()`).
- **Server read**: `use-in-context.ts` loops the directive's arguments off the executing
  operation; it now `JSON.parse`s `context` into the typed bag (a malformed blob is ignored).
- **Compiler** (`query/build/compile.ts`): emits `$__context: String` +
  `@inContext(context: $__context)` on **every** compiled operation — no config gate (§4).
  **The directive and the variable are inseparable** — GraphQL rejects a declared-but-unused
  variable, so the directive argument is what legalizes `$__context`. Locale keeps its own
  i18n-gated arg; both ride one directive when present.

### 3. The gated override hook (server)

Generalise the binding so tenant/features can see the operation. Add a
per-operation `operationContext` resolver to `UseDatabaseOptions` — a noun naming
what it produces (the operation's `AppContext`), alongside the request-level
`tenant`/`features`/`principal`.

**Signature.** The callback receives the request-scoped `base` and a small
per-operation descriptor `op` that Pylon builds (never the raw envelop payload):

```ts
interface OperationInfo {
  /** The operation's per-op `OperationContext` bag (`{}` when none), already parsed (§2).
   *  The acting tenant is `op.context.actingTenant`. UNGATED — the hook decides. */
  context: OperationContext
  /** Everything `@inContext` carried, incl. `locale`. `context` above is the sugar. */
  inContext: InContext
  /** 'query' | 'mutation' | 'subscription'. */
  operationType: 'query' | 'mutation' | 'subscription'
  /** The operation name, if the document names one. */
  operationName?: string
  /** The operation's coerced variables. Escape hatch — not needed for acting-as. */
  variables: Record<string, unknown>
  /** The Hono request context (headers, etc.). Escape hatch; undefined off-request. */
  honoContext: any
}

interface UseDatabaseOptions {
  // …existing tenant/features/principal/debug…
  /**
   * Refine the request `AppContext` per operation. Runs once per operation, inside
   * that operation's execution scope (§1). Return the context to bind for this op —
   * the unchanged `base` for the common case, or an override. The principal lives on
   * `base`, not `op` (gate on `base.principal`). Pylon NEVER infers the gate: it just
   * applies whatever you return.
   */
  operationContext?: (
    base: AppContext,
    op: OperationInfo
  ) => AppContext | Promise<AppContext>
}
```

The app's policy (the whole reason the hook exists):

```ts
useDatabase({
  operationContext: async (base, op) => {
    const acting = op.context.actingTenant
    if (!acting) return base                                    // no override
    if (!hasRole(base.principal, 'SUPER_ADMIN')) return base    // GATE — deny by default
    const tenant = await Tenant.objects.filter({ id: acting }).first()
    if (!tenant) throw new BadRequestError('Unknown acting tenant')
    return { ...base, tenant: tenant.id, features: featureStateOf(tenant) }
  },
})
```

Pylon's job: call this per operation, apply the returned `AppContext` to that
operation's ALS scope (§1). Pylon must **never** infer the gate itself — a missing
or forbidden `actingTenant` yields the unchanged `base` (own tenant).

### 4. Client: per-operation option (cache key comes for free)

- Add a per-call option to
  [`../packages/pylon/src/pages/pages/use-data.ts`](../packages/pylon/src/pages/pages/use-data.ts)
  and
  [`../packages/pylon/src/pages/pages/use-mutation.ts`](../packages/pylon/src/pages/pages/use-mutation.ts):
  `useData(selector, { context: { actingTenant } })`, `useMutation(name, { context })`. The
  option supplies the `$__context` **variable value** for that operation only, as canonical
  JSON (`stableStringify`, so key order can't split the cache). The shell's hooks pass
  nothing → the variable is absent → the call binds the viewer's own tenant. This is what
  makes §Motivation point 2 a non-issue. It is guarded by the doc's `opContext` flag, so a
  stray `{ context }` on a hand-written document is dropped rather than sent as an unknown
  variable.
- **Cache key is automatic — the payoff of a variable transport.** The store keys every
  entry on `opKey(doc, variables) = documentId ~ variablesHash(variables)`
  ([`../packages/pylon/src/query/runtime/doc.ts`](../packages/pylon/src/query/runtime/doc.ts)),
  and `variablesHash` sorts nested keys recursively — so the context bag is part of the
  operation's cache identity by construction, exactly the property that already keeps two
  locales in two entries. No separate metadata to fold in, nothing to forget: the key and the
  value are the same thing.
- **Emission is always-on, not opt-in.** The compiler emits `$__context` +
  `@inContext(context: $__context)` on **every** compiled operation (queries and mutations),
  because the channel is inert until the server gate acts on it — so there is no config flag,
  and the per-operation behaviour comes entirely from the runtime *value* (absent on shell
  calls, present on admin calls). (The alternative, per-call-site emission, was rejected: the
  analyzer preserves call-site options for the runtime rather than parsing them at build time,
  so it can't see the value — and always-on is inert anyway.) Enabling this changes every
  document id once, like `i18n` — an ephemeral cache/hydration invalidation on upgrade.

### 5. SSR threading (falls out of §2 + §4 — no special channel)

With `@inContext` there is nothing bespoke to thread. `useData` resolves during
server render **in-process** (not over HTTP), and SSR *already* supplies operation
variables in-process — locale reaches the server render exactly this way today: the
per-request pylon-query client is created with the negotiated locale
([`../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx`](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)),
and compiled documents send it as `$__locale`
([`../packages/pylon/src/query/build/index.ts`](../packages/pylon/src/query/build/index.ts)
reads it from `__pylonStaticData`). The acting tenant rides the identical rail: the
`{ actingTenant }` call option provides the variable at render time, the in-process
executor sees it in `variableValues`, and §1 binds the target tenant for that op.

The first-paint-then-correct flash the original design worried about is
**structurally impossible** here: because the acting tenant is a variable, it is part
of the operation's inputs that serialise into `__pylonStaticData`, so the client
computes the *same* `opKey` (§4) from the *same* variables and hydrates onto the
server-rendered entry — server and client cannot disagree on which tenant an entry
belongs to.

## Security model (must be airtight)

1. **Gate.** Honour `actingTenant` only for a principal that passes the app's
   privilege check (`SUPER_ADMIN`). For anyone else: ignore, fall back to their own
   tenant. Deny-by-default — a bad value must never *widen* access.
2. **Validate.** The acting tenant must exist; otherwise error, never silently use
   own tenant.
3. **Features follow the tenant.** The override resolves the **target** tenant's
   `FeatureState`; otherwise every feature gate on the acted page reads the admin's
   own org's features. This is an async step per acted operation.
4. **Audit.** Acting-as carries **write** power (a `SUPER_ADMIN`'s `userCreate` now
   writes into another org). Emit an audit event per acting-as operation (actor,
   target tenant, operation) via the existing audit pipeline. Being per-operation
   and explicit — versus a sticky "switch tenant" session mode — is itself a safety
   property: no ambient acting state leaks into the next call.

## Non-goals

- **Realtime.** The SSE/`dataRefetch` sync is bound to the viewer's tenant; live
  updates for the acted org will not stream. Acceptable — the admin surface refetches
  on mutation. Not addressed here.
- **A sticky "log in as tenant" session mode.** Deliberately out of scope: it
  re-introduces the request-wide / ambient-leak hazard this RFC avoids. If ever
  wanted, it layers on top (a session flag feeding the same override), with its own
  shell treatment (a persistent "acting as X" banner) and audit.
- **Non-tenant overrides.** The hook is shaped generically (returns an `AppContext`),
  but only tenant + features are in scope here; overriding `principal` per operation
  is explicitly not part of this RFC.

## Implementation status

The framework mechanism (§1, §2, §4, §5) is **implemented** on branch `feat/acting-tenant`;
§3's gate is app-side policy. What landed:

1. **Generic `context` channel (§2)** — `IN_CONTEXT_SDL` gains `context: String`;
   `OperationContext` (app-augmentable, read via `getInContext().context`) in `core/in-context.ts`;
   `use-in-context.ts` parses it; `compile.ts` emits `$__context` on every compiled op
   (always-on, `OP_CONTEXT_VARIABLE`), marked `opContext: true` on the doc. One dedicated
   compile test + the analyzer's selectors-to-document test lock the emission.
2. **Per-op `AppContext` bind (§1)** in `db/plugin.ts` — the keystone: `onExecute` wraps the
   executor with `setExecuteFn`, reading `getInContext()` at execute time (order-independent)
   and entering `runWithAppContext(opCtx)` around resolution. `operationContext(base, op)` +
   `OperationInfo` on `UseDatabaseOptions`; the request connection stays request-scoped.
3. **Client per-op option (§4)** — `useData(sel, { context })` / `useMutation(k, { context })`
   merge `$__context` as canonical JSON, guarded by `doc.opContext`; the store needs no
   cache-key change (it's already a variable). SSR (§5) falls out for free.
4. **Gated override hook (§3)** + audit — app-side policy; the framework calls the hook and
   applies whatever it returns, never inferring the gate.

Full `pylon` typecheck + unit suite green (the one unrelated `app-utils` snapshot failure is
from pre-existing uncommitted work, not this branch). A **live e2e** (`acting-tenant-app` +
`e2e/tests/acting-tenant-serve.e2e.test.ts`, Dockerized Postgres) proves the whole path over
real HTTP: directive-in-schema, baseline tenant isolation, a SUPER_ADMIN seeing the acted org
through the *ordinary* resolver, the gate denying a non-privileged caller, the rebind being
per-operation with no ambient leak, and an acting write landing in the acted org (6/6 green).

## Alternatives considered

- **Parallel admin resolvers** (`tenantUsers`, `tenantUserCreate`, `tenantStats`, …
  each `requireRole(SUPER_ADMIN)` + `unscoped()`). Works today with **no framework
  change** and is explicitly gated per surface; the cost is duplicating every
  tenant-scoped resolver you want to expose to admins. Reasonable as an interim in an
  app; this RFC is the DRY end-state that makes them unnecessary.
- **Request-wide tenant override** (a header honoured in the existing per-request
  `tenant(c)`). Minimal server change, but corrupts the shared app shell (§Motivation
  point 2). Rejected.
- **`.unscoped()` as ambient model fields.** Puts a security bypass on the shared
  schema, ungated at the field, relying on "only admins can load another tenant."
  Rejected — the bypass must be gated at the seam, not implied by call site.
