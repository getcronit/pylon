---
'create-pylon': major
---

Update the scaffold templates to the v3 contract — every runtime `create-pylon` produced
failed on its first `pylon build`.

The templates still emitted the pre-`Pylon`-class shape: a named `export const graphql`
plus a `serve(app, …)` side effect in the entry. Since the compiler now type-introspects
the DEFAULT export, Node projects died with "Pylon entry must export default the app",
while Bun and Cloudflare Workers projects got further on `export default app` (the empty
singleton) and then failed with the far less obvious "Query root type must be provided" —
their resolvers silently dropped.

- The entry is now `export default new Pylon({graphql})` and is identical across runtimes:
  pure, with no import-time serving side effect.
- Serving is declared in `pylon.config.ts`. Node scaffolds get `useNodeServer()`, ordered
  last so the port binds only after every route (including the usePages catch-all) is
  mounted; Bun, Deno and workerd need no plugin — they serve the default export of the
  built `.pylon/server.mjs` themselves.
- Dropped `pylon dev -c "<cmd>"` from the Bun, Deno and Cloudflare Workers scripts. `pylon
  dev` is direct in-process execution now and rejects `-c` outright.
- Deno projects get a `package.json`. `pylon dev`/`pylon build` are Node processes, and
  Node's TypeScript loader reads the nearest `package.json` for ESM-vs-CJS — without
  `"type": "module"` the build failed on `require(esm)` loading `pylon.config.ts`. It also
  becomes the single source of truth for the dependency, so `deno.json` drops its duplicate
  `imports` entry. Its `start` task uses `deno serve` (`deno run` does not serve a default
  export).
- Dropped the now-unneeded `@hono/node-server` dependency from Node scaffolds (the entry no
  longer imports it, and `@getcronit/pylon` depends on it).
- Fixed both Dockerfiles running `{npm,bun} run pylon build`, which is not a script in the
  generated `package.json`.

Pages templates: the starter Button carried a typo'd `inline-flexxx` class, which Tailwind
does not generate — the button silently lost `display: inline-flex` and the
`items-center justify-center gap-2` layout that depends on it. `components.json` also
pointed `tailwind.config` at a `tailwind.config.js` the scaffold never emits; the scaffold
is Tailwind v4 (theme in `globals.css` under `@theme`), so that field is now `""`, which is
what `npx shadcn@latest add …` reads to target the v4 component shape.

Pages templates, Tailwind v4: the theme block is now `@theme inline`. A plain `@theme`
emits `--color-background: hsl(var(--background))` into `:root`, where custom-property
substitution happens once — the resolved colour then inherits down as a literal, so a
nested `.dark` re-declaring `--background` never reached it and `bg-background` (and even
`dark:bg-card`) stayed light. That contradicted the scaffold's own
`@custom-variant dark (&:is(.dark *))`, which targets descendants of `.dark` rather than
requiring it on `<html>`. Both scopings now work.

Pages templates: the root layout is typed with the exported `LayoutProps` instead of an
ad-hoc `{children: React.ReactNode}`, so the starter shows that a layout also receives
`params`, `searchParams`, `path` and `context`.

CLI: a bare `--features` (no values) crashed with `features is not iterable`; it now means
"no features". Added `--no-install` and `-y, --yes` so the CLI can run unattended in
scripts and CI.

A new e2e (`e2e/tests/create-pylon-scaffold.e2e.test.ts`) scaffolds every runtime and
feature combination with the shipped binary, runs the shipped `pylon build` on each, and
boots the built Node artifact to query it over HTTP — so the templates cannot drift away
from the framework unnoticed again.
