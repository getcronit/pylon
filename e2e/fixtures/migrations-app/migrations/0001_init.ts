import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "ShopCategory",
      "table": "shop_category",
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
          "property": "name",
          "name": "name",
          "sqlType": "text",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": true,
          "nullable": false
        }
      ]
    }),
    migrations.createTable({
      "name": "ShopProduct",
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
          "property": "categoryId",
          "name": "category_id",
          "sqlType": "bigint",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        }
      ]
    }),
    migrations.addForeignKey({
      "table": "shop_product",
      "name": "shop_product_category_id_fkey",
      "column": "category_id",
      "refTable": "shop_category",
      "refColumn": "id"
    })
  ]
})
