---
'@getcronit/pylon': patch
---

Stop `pylon build --standalone` from drowning real trace warnings in noise.

`@vercel/nft` emits a warning for every dynamic/conditional dependency it can't statically
follow. Most are pure noise for a deploy trace — it tried to parse non-code files (license
text, prebuilt binaries) as JavaScript, or probed an optional native dep (`pg-native`,
`cloudflare:sockets`, …) or another platform's `@img/sharp-*` / `@esbuild/*` variant that is
absent by design — and dumping the whole list (dozens of lines) read like a catastrophe over a
working build.

Trace warnings are now classified: benign classes are counted and hidden, and only warnings
that could mean a genuinely MISSING runtime file (an unresolved bare/relative specifier the app
may need via `--include`) are surfaced. A build with only benign notes stays quiet at the
default level.
