import {useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// `routing: 'cookie'` — the request decides the locale. Correct only for authenticated app
// UI: it serves different content at one URL, so a crawler sees a single-language site.
// Public content needs `'prefix'`, which lands with locale routing.
export default {
  plugins: [
    usePages({
      i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en', routing: 'cookie'}
    }),
    useNodeServer()
  ]
} satisfies PylonConfig
