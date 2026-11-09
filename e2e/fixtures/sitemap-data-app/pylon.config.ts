import {useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

// `origin` makes the sitemap emit absolute URLs (and never advertise the request host).
export default {
  plugins: [usePages({origin: 'https://shop.example'}), useNodeServer()]
} satisfies PylonConfig
