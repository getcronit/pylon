---
"@getcronit/pylon": patch
---

fix(config): add logger and graphiql options to config

```ts
export const config: PylonConfig = {
  logger: false, // Disables the default logger
  graphiql: false // Disables `graphiql` (Playground) and `viewer`
}
```
