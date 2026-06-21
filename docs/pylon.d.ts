import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {}

  interface Variables {}
}

import {Data as ClientData} from './.pylon/client'

declare module '@getcronit/pylon-pages' {
  interface Data extends ClientData {}
}
