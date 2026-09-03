---
'@getcronit/pylon': minor
---

Gateway: make the patch map an actual boundary — argument policies, guards, strict mode, and a schema cache that recovers.

A patch transforms the **result** of a delegated field, so it constrains neither
the arguments a client sends nor the types a selection can reach. Where a gateway
fronts an admin API with a fixed service credential, that made the patch map an
allowlist for the one axis people assume it covers, and default-allow on two
others.

**`pass` — argument policies on a patch** (#113, #118)

A constraint applied in one resolver did not apply to the same rows reached
through a nested field, because the client's arguments travel to the remote
untouched. Measured on a real storefront: 622 product rows reachable through
nested connections where 226 were publishable.

```ts
import {createGateway, pass} from '@getcronit/pylon'

createGateway<Registry>().configure({
  url,
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
})
```

`force` is written into the outgoing request, and a caller may not supply a
forced argument — discarding their value silently is the same "looks like it
worked" failure the boundary exists to remove. `args` is an allowlist for what
they may set, so an argument the remote adds later is denied by default. The two
are disjoint. The type name comes from the patch's key, and the nested selection
still travels in the parent's single request.

**`guard` — decide with a field you do not expose** (#117)

Fields fetched through `needs` were invisible to TypeScript, so every guard
re-stated the selection in an unchecked cast that kept compiling after the
`needs` entry was removed.

```ts
catalogue.delegate('Query.product', {
  args: {handle},
  needs: {status: true, isPublished: true},
  guard: r => r.status === 'ACTIVE' && r.isPublished
})
```

`r` is typed from `needs`; a rejection resolves to `null`. The returned type is
deliberately unchanged — intersecting the needs fields into it mints a
structurally new type and the schema builder rejects the duplicate.

**`strict` — a type with no patch is not published** (#114)

A type reachable through a patched field but not itself patched went out whole,
and grew as the remote did. Off by default; `passthrough()` marks a type as
deliberately transparent.

**Schema cache evicts on failure** (#115)

The cache held the introspection *promise*, so one rejection — the remote being
down when the first request arrived — was replayed for the life of the process.
The gateway never recovered from a remote restart and reported a connection error
for a remote that was up.
