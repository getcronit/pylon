// Standalone Pylon config (no longer an inline export from src/index.ts).
// `satisfies` keeps it typed and dependency-free; `defineConfig` is also supported.
import type {PylonConfig} from '@getcronit/pylon'

export default {
  graphiql: false,
  landingPage: false
} satisfies PylonConfig
