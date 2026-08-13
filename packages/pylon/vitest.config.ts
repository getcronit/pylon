import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vitest/config'

// The folded features' tests live under test/<feature>/. They import the public
// surface as self-references (`@getcronit/pylon`, `@getcronit/pylon/db`, …) and
// reach into internals via relative `../../src/<feature>/…` paths. Alias every
// public subpath to its SOURCE entry so the whole suite runs against one copy of
// each module — no build step, and (crucially) a single model-registry instance
// shared between the `@getcronit/pylon/db` and `../../src/db/index` import forms.
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))
const alias = [
  // Mirror tsconfig `baseUrl: ./src` + `@/* → ./*` so tests reach internals as
  // `@/db/manager` (same convention the source uses) instead of `../../../src/…`.
  {find: /^@\//, replacement: src('') + '/'},
  {find: /^@getcronit\/pylon\/db\/plugin$/, replacement: src('db/plugin.ts')},
  {find: /^@getcronit\/pylon\/db$/, replacement: src('db/index.ts')},
  {find: /^@getcronit\/pylon\/ir$/, replacement: src('ir/index.ts')},
  {find: /^@getcronit\/pylon\/queues\/plugin$/, replacement: src('queues/plugin.ts')},
  {find: /^@getcronit\/pylon\/queues$/, replacement: src('queues/index.ts')},
  {find: /^@getcronit\/pylon\/auth\/plugin$/, replacement: src('auth/plugin.ts')},
  {find: /^@getcronit\/pylon\/auth\/contract$/, replacement: src('auth/contract.ts')},
  {find: /^@getcronit\/pylon\/auth\/zitadel$/, replacement: src('auth/zitadel.ts')},
  {find: /^@getcronit\/pylon\/auth$/, replacement: src('auth/index.ts')},
  {find: /^@getcronit\/pylon\/pages\/plugin$/, replacement: src('pages/plugin.ts')},
  {find: /^@getcronit\/pylon\/pages$/, replacement: src('pages/index.ts')},
  {find: /^@getcronit\/pylon\/query\/build$/, replacement: src('query/build/index.ts')},
  {find: /^@getcronit\/pylon\/query$/, replacement: src('query/index.ts')},
  {find: /^@getcronit\/pylon$/, replacement: src('core/index.ts')}
]

export default defineConfig({
  resolve: {alias},
  esbuild: {
    target: 'es2022',
    // The ORM's decorator-based model authoring needs legacy decorators + fields
    // that don't use `defineProperty` semantics.
    tsconfigRaw: {
      compilerOptions: {experimentalDecorators: true, useDefineForClassFields: false}
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // db integration shares one Postgres (single `_pylon_migrations` ledger) and
    // queues integration shares one Redis — run files sequentially so they don't
    // race. Unit tests are fast, so serializing everything costs little.
    fileParallelism: false
  }
})
