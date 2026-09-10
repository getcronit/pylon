---
'@getcronit/pylon': patch
---

Make plugin-setup failures legible.

When a plugin's `setup()` threw, the framework wrapped it by stringifying the original error's
full `.stack` into a NEW error's message. Node then printed that blob PLUS the wrapper's own
stack — a duplicated, nested wall of text with the actual one-line cause (e.g. "Module …/de.json
needs an import attribute of type: json") buried in the middle.

The wrapper now keeps its message to one human-readable line (the underlying error's `.message`)
and attaches the original error via `cause`, so Node renders a clean `[cause]:` chain with the
real stack intact. Built-in plugins that lacked a `name` (`usePages` → `pages`, `useQueues` →
`queues`) now set one, so the failing plugin is named in the message instead of shown as `#1`.
