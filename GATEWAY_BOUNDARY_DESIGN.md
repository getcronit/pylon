# Gateway boundary: default-deny patches

Making `createGateway`'s patch map an actual access-control boundary, instead of
one that holds for fields you remembered and leaks everywhere else.

Addresses #113 (arguments), #114 (unpatched types), #115 (schema cache),
#117 (typing `needs`), #118 (argument allowlist).

## The problem

A gateway patch is documented as an allowlist, and people use it that way: the
patch names the fields a remote type exposes, so a field the patch does not
mention cannot be selected. Where the remote is an admin API and the gateway is
a public storefront, that map *is* the security boundary.

It holds for exactly one axis. A patch is a **result** transform — the whole of
`PylonPatchTransform` runs in `transformResult`, and its `transformRequest` only
injects `__typename`. Two things follow, and both are default-allow:

**Arguments are not covered.** A passed-through field keeps whatever arguments
the remote declares, and the client's values reach the remote untouched. A
constraint applied in the resolver (`Query.products` prepending
`status:ACTIVE published:true`) does not apply to the same rows reached through
`ProductCollection.products`. Measured on a real storefront: 622 product rows
reachable through nested connections where 226 are publishable — every draft
readable by handle and title. When the remote later added a `query` argument to
that nested field, the passthrough silently gained it, and drafts became
selectable *by name*, with no change to any gateway code.

**Types are not covered either.** `applyTransforms` ends with:

```ts
const patchFn = typeName ? (this.patches as any)?.[typeName] : undefined
if (patchFn) { … }
return processedData      // no patch: the whole remote object goes out
```

so a type reachable through a patched field but not itself patched is published
whole. In the same storefront, `UnitPriceMeasurement` contributes four fields to
the public API although no line of gateway code names it.

The asymmetry to fix: a new upstream **field** is denied by default; a new
upstream **argument**, and a newly reachable **type**, are granted by default.

## What shapes the design

`delegateToSchema` sends the client's selection to the remote. By the time a
patch runs, the query has already executed *there* — so a result transform can
never constrain what was asked. Anything that constrains has to write the
outgoing document.

That capability already exists and is already used: `buildSelectionsFromNeeds`
writes `__args` onto nested selections for `needs`. What is missing is applying
it to fields the **client** selected rather than ones we added.

`InlineArgsTransform` is close but root-only — it matches
`delegationContext.fieldName` and stops:

```ts
if (!targetFieldFound && node.name.value === targetFieldName) { … }
```

so nested fields are unreachable by any argument handling today.

The other constraint is that **forcing needs no parent data**. A nested
connection is already scoped to its parent by the remote, so the constraint on
`ProductCollection.products` is the same constant as on `Query.products`. This
is what makes a static declaration sufficient, and it is why the workaround
people reach for today — re-delegating from the root with a synthesised filter —
is both unnecessary and worse:

```ts
// today's workaround: a re-implementation, and one round trip per row
products: (first?: Int, skip?: Int) =>
  api.delegate('Query.products', {
    args: {query: visible(`collections.handle:${c.handle}`), first, skip}
  })
```

`collections.handle:X` is a *guess* at what the remote's nested field means. If
the remote counts sub-collection membership, or orders differently, the two
diverge with nothing to catch it. And the nested selection no longer rides in
the parent's query, so it is N+1.

## Design

Three additions, each closing one default-allow.

### 1. Argument policy — `pass` (implemented)

A policy attached to the patch, so the boundary for a type is declared in one
place:

```ts
patches: {
  ProductCollection: pass(
    c => ({handle: c.handle, name: c.name, products: c.products}),
    {
      products: {
        args: ['first', 'last', 'after', 'before', 'skip'],
        force: {query: 'status:ACTIVE published:true'}
      }
    }
  )
}
```

- `force` is written into the outgoing document. A constraint, not a default —
  and a caller may not supply a forced argument at all. Silently discarding
  what they sent is the same "looks like it worked" failure the whole boundary
  exists to remove, so it is refused instead. (Found by porting a real
  storefront: forcing alone let a caller send `query: "status:DRAFT"` and get
  the constrained set back with no error.)
- `args` is an allowlist, enforced on the request: an argument outside it is
  rejected, so an argument the remote adds later is denied by default.
- The two are disjoint — `args` is the caller's, `force` is the gateway's.
- Forced names are taken from the RESOLVED values, so a `(ctx) => undefined`
  forces nothing and the caller's own value stands.
- Keyed on parent type + field, resolved with a `TypeInfo` walk — the document
  alone says `products`, not *which* `products`. The type name comes from the
  patch's key.
- Runs last among the request transforms, so it also wins over anything
  `InlineArgsTransform` or `needs` wrote.
- The nested selection still travels inside the parent's single request. No
  N+1, and no re-implementation of what the field means.

Values are constants or `(ctx) => value` for per-request ones, resolved once per
request. Deliberately **not** a function of the parent row: that would require
the parent to be fetched first, reintroducing the round trip this exists to
avoid.

Root fields are not covered and do not need to be — a delegated root field is
called from your own resolver, which already decides its arguments.

**`pass` must return the argument's own function type.** An earlier signature,
`pass<F extends (data: any, api: any) => any>(patch: F): F`, types `data` as
`any` before the surrounding `patches` map can contextually type it, so every
patch loses the registry type of its own argument. Generic in the *parameters*
(`<D, A, R>`) keeps it.

#### Deferred: removing the argument from the SDL

`args` is enforced on the request, not carved out of the published schema, so a
denied argument is still advertised and fails when used. Removing it needs the
schema builder to filter arguments by name: arguments come from
`signature.getParameters()` in `schema-parser.ts`, and TypeScript cannot filter a
positional parameter list by name — parameter names are not extractable from a
function type. That is a change to schema generation, on the path every Pylon app
builds through, and it is tracked separately rather than bundled here.

### 2. Default-deny for reachable types — `strict` (implemented)

```ts
createGateway<RemoteRegistry>().configure({url, strict: true, patches: {…}})
```

Under `strict`, `applyTransforms` reaching a `__typename` with no patch is an
error rather than a passthrough. For types that genuinely should pass whole,
say so explicitly, so it is a decision in the code and not an omission:

```ts
Money: passthrough()
```

Runtime enforcement is the floor, and is what ships here. Because the registry
and the patch map are both known ahead of time, "field `X.y` returns unpatched
type `Z`" is decidable at build time, and that is where it ultimately belongs —
a reachability check reported as a build error, with this runtime guard as the
backstop. **Deferred**, and the reason `strict` is opt-in: a runtime-only check
surfaces on the first request that reaches the type rather than at build.

### 3. Schema cache evicts on failure (implemented)

`schemaCache` stores the introspection promise, so one rejection is permanent —
the gateway keeps replaying the original connection error after the remote is
healthy, and only a restart clears it. Cache the resolved schema; delete the
entry on rejection so the next request retries.

## Compatibility

- `pass`, `guard` and `passthrough` are additive; a plain patch function and a
  plain `delegate` keep working unchanged.
- `strict` defaults to **off**. Turning it on is a breaking change for an
  existing gateway (previously reachable types disappear), which is exactly the
  point, so it is opt-in and should be loud: list what it would remove.
- Fixing the schema cache changes only the failure path.

## Status

**Implemented**: `pass` (argument allowlist + forced arguments), `guard`,
`strict` + `passthrough()`, schema-cache eviction. Covered by
`test/core/gateway-boundary.test.ts` and the gateway serve e2e.

### `guard`, and the return type that could not carry `needs`

The first attempt at typing `needs`-fetched fields intersected them into
`delegate`'s return:

```ts
): Promise<PatchSchema<…> & NeedsResult<TNeeds, Raw>>
```

It typechecks, and it breaks schema generation. An intersection is a
structurally new type, so the builder names it afresh — a second `Org_1`
alongside `Org`, `FullUser_1` alongside `FullUser` — and then fails with
*"There can be only one type named Org_1"*. Verified by building a fixture with
and without the intersection.

`guard` is the shape that works: the fields land in the **callback's** parameter
type, never in the returned type the schema is generated from.

```ts
delegate('Query.product', {
  args: {handle},
  needs: {status: true, isPublished: true},
  guard: r => r.status === 'ACTIVE' && r.isPublished
})
```

A rejection is `null`, not an error — "not visible to you" and "does not exist"
are the same answer to a caller who may not know the difference. Typed at real
scale: against a 5,263-line generated registry the guard parameter resolves to
`{status: ProductStatus; isPublished: Boolean}`, with no inference blowup
(~2s typecheck).

Guarding a delegated **connection** is still unanswered, and deliberately so:
dropping rows after the fetch leaves `totalCount`, cursors and page size lying
about what was filtered. A constraint on a connection has to go upstream, which
is what `force` is for.

### Deferred

| | why |
| --- | --- |
| removing denied arguments from the SDL | needs argument-name filtering in the schema builder; positional signatures make it inexpressible as a type transform |
| build-time reachability check for `strict` | decidable from the registry + patch map, but a separate pass |
| guarding connection rows | post-fetch filtering cannot keep pagination honest — belongs upstream |
