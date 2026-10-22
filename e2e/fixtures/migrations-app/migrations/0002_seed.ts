// A reversible data migration: seeds two categories on `up`, removes them on
// `down`. Demonstrates that authored `runSql` operations (not just generated
// schema diffs) apply and roll back correctly.
import {migrations} from '@getcronit/pylon/db'

export default migrations.defineMigration({
  operations: [
    migrations.runSql(
      `INSERT INTO "shop_category" ("name") VALUES ('Books'), ('Toys')`,
      {down: `DELETE FROM "shop_category" WHERE "name" IN ('Books', 'Toys')`}
    )
  ]
})
