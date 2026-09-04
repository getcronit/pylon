---
'@getcronit/pylon': patch
---

Improve `pylon dev` debugging and quiet a dev-server warning.

- **`pylon dev --inspect [port]`** (and `--inspect-brk`) opens the Node inspector on
  the dev process itself — the one that runs your resolvers — so breakpoints bind and
  you get a single clean debug target. It works through a package manager
  (`pnpm pylon dev --inspect`) because it doesn't rely on an inherited `--inspect` flag
  that the package-manager wrapper would grab first.
- When dev *is* launched with an inherited inspector (`node --inspect …/pylon dev` or
  `NODE_OPTIONS=--inspect`), the flag is now stripped from what the bundler workers
  inherit (`NODE_OPTIONS` + `execArgv`), so they no longer race the app for the port —
  no more `Starting inspector … address already in use` stack, and DevTools attaches to
  your code instead of a worker.
- Filtered a spurious `optimizeDeps.esbuildOptions … deprecated` warning from the pages
  dev server. It originates in `@vitejs/plugin-react` (the version compatible with the
  transitional `rolldown-vite`); rolldown-vite honors the option but warns, and the fix
  upstream needs Vite 8. The warning is dropped until those majors line up.
- With a debugger attached, the dev logger now splits its output cleanly: the terminal
  keeps a single pretty line per record while the Chrome DevTools console receives the
  full record as an expandable, inspectable object (via `inspector.console`, which
  bypasses stdout) — no more multi-line object dumps in the terminal.
