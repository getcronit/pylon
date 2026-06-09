// Hand-authored initial migration. Raw DDL with an explicit `down` for each
// statement, so the whole migration is reversible. Operations run top-to-bottom
// on `up` and bottom-to-top on `down` — so the product table (which references
// the category) is created last and dropped first.
import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  operations: [
    migrations.runSql(
      `CREATE TABLE "shop_category" (
        "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        "name" text UNIQUE NOT NULL
      )`,
      {down: `DROP TABLE "shop_category"`}
    ),
    migrations.runSql(
      `CREATE TABLE "shop_product" (
        "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        "title" text NOT NULL,
        "category_id" bigint NOT NULL REFERENCES "shop_category" ("id")
      )`,
      {down: `DROP TABLE "shop_product"`}
    )
  ]
})
