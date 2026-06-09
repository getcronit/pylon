// A REAL Node Pylon app: ORM models + a top-level serve(app). Before the
// side-effect-stripping fix, `pylon build` would execute this entry to read the
// models and start a server (hanging the build). It must now build cleanly.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {Model, model, id, text, boolean} from '@getcronit/pylon-orm'

@model()
export class Widget extends Model {
  id = id()
  name = text({unique: true})
  active = boolean({default: true})
}

export const graphql = {
  Query: {
    widget: (): Widget => ({}) as Widget,
    widgets: (): Widget[] => []
  },
  Mutation: {}
}

// Top-level side effect — the footgun. Must NOT run during the build.
serve(app, info => {
  console.log(`Server running at ${info.port}`)
})
