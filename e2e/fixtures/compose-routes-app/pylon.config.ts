import type {PylonConfig} from '@getcronit/pylon'
// No infra plugins — just serving (the app owns it; the framework only boots).
export default {plugins: []} satisfies PylonConfig
