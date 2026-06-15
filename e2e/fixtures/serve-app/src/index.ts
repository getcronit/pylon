// Real Node Pylon app: models + the app default-exported. The framework owns
// serving (the generated entry serves the instance), so there's no top-level
// serve() to accidentally run during the build.
import {Pylon} from '@getcronit/pylon'
import {models} from '@getcronit/pylon-db'

@models.model()
export class Widget extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  active = models.Boolean({default: true})
}

export default new Pylon({
  graphql: {
    Query: {
      widget: (): Widget => ({}) as Widget,
      widgets: (): Widget[] => []
    },
    Mutation: {}
  }
})
