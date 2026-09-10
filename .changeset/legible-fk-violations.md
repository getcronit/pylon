---
'@getcronit/pylon': patch
---

Surface foreign-key violations with a message a human can act on.

A manyToMany link whose owner or target row doesn't exist failed with Postgres's opaque
`insert or update … violates foreign key constraint "<hash>"` — no hint at WHICH side, WHICH id,
or WHICH relation, buried under a kysely/pg stack. `ManyToManyManager.add`/`set` now map the
23503 SQLSTATE (via the new `foreignKeyViolation` helper + `ForeignKeyViolationError`) to a
message that names the missing model and id from the driver's `detail` — e.g. *"Cannot link
ProductVariant ↔ ProductOptionValue: ProductOptionValue \"…\" does not exist. It was referenced
but not found — likely created out of order, or removed earlier in the same operation."* — with
the driver error kept as `cause`. This mirrors the existing unique-violation (23505) mapping.
