// A realistic ORM-backed Pylon entry: models + a resolver returning one.
import {Model, model, id, text, boolean} from '@getcronit/pylon-orm'

@model()
export class Product extends Model {
  id = id()
  name = text({unique: true})
  inStock = boolean({default: true})
  $internalNote = text({nullable: true})
  // Hidden via the {hidden} option with a NORMAL name — Pylon's $-regex can't
  // catch this, so only the ORM's exposed:false (via the contribution) hides it.
  internalCode = text({hidden: true, nullable: true})
}

export const graphql = {
  Query: {
    product: (): Product => ({}) as Product
  }
}
