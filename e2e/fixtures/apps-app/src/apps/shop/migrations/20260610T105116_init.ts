import {migrations} from '@getcronit/pylon/db'

export default migrations.defineMigration({
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "Product",
      "table": "shop_product",
      "columns": [
        {
          "property": "id",
          "name": "id",
          "sqlType": "bigint",
          "primaryKey": true,
          "autoIncrement": true,
          "unique": false,
          "nullable": false
        },
        {
          "property": "title",
          "name": "title",
          "sqlType": "text",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        },
        {
          "property": "price",
          "name": "price",
          "sqlType": "integer",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false,
          "check": "\"price\" >= 0"
        }
      ]
    }),
    migrations.createTable({
      "name": "Purchase",
      "table": "shop_purchase",
      "columns": [
        {
          "property": "id",
          "name": "id",
          "sqlType": "bigint",
          "primaryKey": true,
          "autoIncrement": true,
          "unique": false,
          "nullable": false
        },
        {
          "property": "productId",
          "name": "product_id",
          "sqlType": "bigint",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        },
        {
          "property": "buyerId",
          "name": "buyer_id",
          "sqlType": "bigint",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        }
      ]
    }),
    migrations.addForeignKey({
      "table": "shop_purchase",
      "name": "shop_purchase_product_id_fkey",
      "column": "product_id",
      "refTable": "shop_product",
      "refColumn": "id"
    }),
    migrations.addForeignKey({
      "table": "shop_purchase",
      "name": "shop_purchase_buyer_id_fkey",
      "column": "buyer_id",
      "refTable": "blog_author",
      "refColumn": "id"
    })
  ]
})
