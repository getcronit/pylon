---
'@getcronit/pylon': patch
---

Fix `pylon dev` reload loop: only react to source-code edits, not runtime file writes.

The dev watcher watched the whole project and full-reloaded the browser on any file change
(outside node_modules/.pylon/.git). A request whose resolver wrote a file into the project at
runtime — a media thumbnail, cache, log, upload — tripped the watcher, which reloaded the
page, which re-ran the request, which wrote again: an infinite reload loop on that route. The
watcher now reacts only to source extensions (.ts/.tsx/.js/.jsx/.mjs/.cjs/.css) and logs which
file triggered a reload, so runtime data writes no longer cause reloads.
