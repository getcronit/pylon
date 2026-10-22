import {useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// Prefix routing, `as-needed`: `/pricing` is English, `/de/pricing` German. There is no
// `[locale]` folder — the SAME pages/ tree is matched under each locale's basename.
export default {
  plugins: [
    usePages({
      origin: 'https://example.com',
      i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en', routing: 'prefix'}
    }),
    useNodeServer()
  ]
} satisfies PylonConfig
