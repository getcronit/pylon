---
'@getcronit/pylon-dev': minor
'@getcronit/pylon': minor
---

Add new plugin build hook to allow custom esbuild builds.
The build hook is currently called before the pylon main build process.
It does not re-run during watch mode, so you need to implement your own watch logic.

Example:

```ts
function usePagesPlugin(): Plugin {
  return {
    build: async () => {
      // Custom esbuild build
    }
  }
}

export const config: PylonConfig = {
  plugins: [usePagesPlugin()]
}
```
