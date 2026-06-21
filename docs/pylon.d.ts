import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {}

  interface Variables {}
}

import {Data as ClientData, Mutations as ClientMutations} from './.pylon/client'

declare module '@getcronit/pylon-pages' {
  interface Data extends ClientData {}
  interface Mutations extends ClientMutations {}
}
