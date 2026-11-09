import {useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

export default {
  plugins: [
    usePages({
      origin: 'https://example.com',
      i18n: {
        locales: ['en', 'de', 'fr'],
        defaultLocale: 'en',
        // A DIRECTORY, not imports: the build compiles ./messages/<locale> into
        // .pylon/messages/, so catalogs live wherever the app wants — not under src/.
        // French is JSON and deliberately incomplete (no checkout.empty), which exercises
        // both the JSON path and the server-side fallback.
        catalogs: './messages'
      }
    }),
    useNodeServer()
  ]
} satisfies PylonConfig
