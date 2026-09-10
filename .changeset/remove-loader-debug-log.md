---
'@getcronit/pylon': patch
---

Remove a stray `console.log("EXECUTED LOADER 404")` that the usePages route generator
baked into every layout's not-found loader, so it no longer prints on 404s at runtime.
