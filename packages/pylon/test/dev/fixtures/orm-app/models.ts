// A minimal "Pylon project" entry that only registers ORM models — used by the
// `pylon db` CLI test to exercise the in-process model-loading bridge.
import {Pylon} from '@getcronit/pylon'
import {Model, id, text, boolean} from '@getcronit/pylon/db'

export class Account extends Model {
  id = id()
  email = text({unique: true})
  active = boolean({default: true})
}

export default new Pylon({db: {models: [Account]}})
