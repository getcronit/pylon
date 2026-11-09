---
"@getcronit/pylon-builder": patch
---

Re-release the builder fix for optional enum arguments (originally shipped in #119). Version 2.6.10 was consumed by a CI canary snapshot and published under the `canary-pr-121` dist-tag, which permanently reserves that version on npm — so it can never reach `latest`. This re-releases the same fix as 2.6.11.
