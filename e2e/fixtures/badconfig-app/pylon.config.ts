import type {PylonConfig} from '@getcronit/pylon'

// Top-level throw: the bundled config.js evaluates this on import. Pre-fix this was
// swallowed (app booted with NO plugins); now it must abort the build loudly.
throw new Error('boom: pylon.config failed to load')

export default {plugins: []} satisfies PylonConfig
