// Real Node Pylon app: models + a top-level serve(app). Must build cleanly
// (models loaded without running serve).
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {models} from '@getcronit/pylon-db'

@models.model()
export class Widget extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  active = models.Boolean({default: true})
}

export const graphql = {
  Query: {
    widget: (): Widget => ({}) as Widget,
    widgets: (): Widget[] => []
  },
  Mutation: {}
}

serve(app, info => {
  console.log(`Server running at ${info.port}`)
})
