// The entry defines + exposes `Gadget`. It NEVER imports `./orphan`, so without
// build-time discovery the orphan `Widget` model would be silently dropped from the
// schema (and its table never created). Discovery must pick it up regardless.
import {Pylon} from '@getcronit/pylon'
import {models} from '@getcronit/pylon-db'

@models.model()
export class Gadget extends models.Model {
  id = models.ID()
  name = models.Text()
}

export default new Pylon({
  graphql: {
    Query: {
      gadgets: (): Gadget[] => []
    },
    Mutation: {}
  }
})
