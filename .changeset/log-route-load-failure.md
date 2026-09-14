---
'@getcronit/pylon': patch
---

Log the error when a route module fails to load (before the recovery reload).

The generated lazy-route loader reloads the page if a page chunk fails to import (recovering
from a stale chunk after a rebuild). It now `console.error`s the failing module + the actual
error first, so a persistently-failing chunk (which otherwise reload-loops silently) is
diagnosable instead of invisible.
