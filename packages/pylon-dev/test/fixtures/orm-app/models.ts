// A minimal "Pylon project" entry that only registers ORM models — used by the
// `pylon db` CLI test to exercise the in-process model-loading bridge.
import {Model, id, model, text, boolean} from '@getcronit/pylon-orm'

@model()
export class Account extends Model {
  id = id()
  email = text({unique: true})
  active = boolean({default: true})
}
