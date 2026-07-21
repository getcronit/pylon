// A realistic ORM-backed Pylon entry: models + a resolver returning one.
import {Pylon} from '@getcronit/pylon'
import {Model, id, text, boolean} from '@getcronit/pylon-db'

export class Product extends Model {
  id = id()
  name = text({unique: true})
  inStock = boolean({default: true})
  $internalNote = text({nullable: true})
  // Hidden via the {hidden} option with a NORMAL name — Pylon's $-regex can't
  // catch this, so only the ORM's exposed:false (via the contribution) hides it.
  internalCode = text({hidden: true, nullable: true})
  // Hidden via TS `private` with a NORMAL name — the RUNTIME contribution can't see
  // the erased modifier, so the AST pass (hidePrivateOrmMembers) must drop it.
  private secretRank = text({nullable: true})
}

export default new Pylon({
  db: {models: [Product]},
  graphql: {
    Query: {
      product: (): Product => ({}) as Product
    }
  }
})
