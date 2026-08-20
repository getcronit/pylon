import {getCookie, useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages, useRequestContext} from '@getcronit/pylon/pages/plugin'

// NOTE the order: `useRequestContext` is listed AFTER `usePages` deliberately. Middleware
// runs in registration order, so array position alone would register it after the usePages
// catch-all and SSR would read an empty context. It works anyway because the helper is a
// 'first'-strategy plugin and usePages is 'last' — the phase wins over array position.
// That is the ordering footgun this helper exists to remove, so the fixture provokes it.
//
// The cookie helpers come from pylon itself — an app cannot resolve `hono/cookie` on its own.
export default {
  plugins: [
    usePages(),
    useRequestContext(
      c => ({
        theme: getCookie(c, 'theme') ?? 'system',
        sidebarOpen: getCookie(c, 'sidebar') !== 'closed',
        locale: getCookie(c, 'locale') ?? 'en'
      }),
      {vary: ['Cookie']}
    ),
    useNodeServer()
  ]
} satisfies PylonConfig
