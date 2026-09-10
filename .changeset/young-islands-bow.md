---
'@getcronit/pylon': minor
---

- Option to disable the playground and introspection in the Pylon configuration. https://github.com/getcronit/pylon/issues/72

### Example

To disable the playground and introspection, set the `graphiql` property to `false` in your Pylon configuration:

```ts
export const config: PylonConfig = {
  // Disable the playground and introspection
  graphiql: false
}
```
