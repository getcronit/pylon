import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {}

  interface Variables {}
}

import {Query} from './.pylon/client'

declare module '@getcronit/pylon-pages' {
  interface Data extends ReturnType<typeof Query> {}
}
