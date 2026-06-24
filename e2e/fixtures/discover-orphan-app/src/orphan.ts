// An ORPHAN model: defined here, imported by NOTHING. Discovery must still load it.
import {models} from '@getcronit/pylon-db'

@models.model()
export class Widget extends models.Model {
  id = models.ID()
  label = models.Text()
}
