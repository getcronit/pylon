import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "ShopCategory",
      "table": "shop_category",
      "abstract": false,
      "primaryKey": "id",
      "implements": [],
      "fields": [
        {
          "name": "id",
          "type": {
            "kind": "scalar",
            "name": "ID",
            "nullable": false
          },
          "exposed": true,
          "column": {
            "name": "id",
            "sqlType": "bigint",
            "primaryKey": true,
            "autoIncrement": true,
            "unique": false,
            "nullable": false
          }
        },
        {
          "name": "name",
          "type": {
            "kind": "scalar",
            "name": "String",
            "nullable": false
          },
          "exposed": true,
          "column": {
            "name": "name",
            "sqlType": "text",
            "primaryKey": false,
            "autoIncrement": false,
            "unique": true,
            "nullable": false
          }
        },
        {
          "name": "products",
          "type": {
            "kind": "list",
            "of": {
              "kind": "ref",
              "name": "ShopProduct",
              "nullable": false
            },
            "nullable": false
          },
          "exposed": true,
          "relation": {
            "kind": "hasMany",
            "target": "ShopProduct",
            "targetFkField": "categoryId"
          }
        }
      ]
    }),
    migrations.createTable({
      "name": "ShopProduct",
      "table": "shop_product",
      "abstract": false,
      "primaryKey": "id",
      "implements": [],
      "fields": [
        {
          "name": "id",
          "type": {
            "kind": "scalar",
            "name": "ID",
            "nullable": false
          },
          "exposed": true,
          "column": {
            "name": "id",
            "sqlType": "bigint",
            "primaryKey": true,
            "autoIncrement": true,
            "unique": false,
            "nullable": false
          }
        },
        {
          "name": "title",
          "type": {
            "kind": "scalar",
            "name": "String",
            "nullable": false
          },
          "exposed": true,
          "column": {
            "name": "title",
            "sqlType": "text",
            "primaryKey": false,
            "autoIncrement": false,
            "unique": false,
            "nullable": false
          }
        },
        {
          "name": "categoryId",
          "type": {
            "kind": "scalar",
            "name": "Int",
            "nullable": false
          },
          "exposed": true,
          "column": {
            "name": "category_id",
            "sqlType": "bigint",
            "primaryKey": false,
            "autoIncrement": false,
            "unique": false,
            "nullable": false
          }
        },
        {
          "name": "category",
          "type": {
            "kind": "ref",
            "name": "ShopCategory",
            "nullable": false
          },
          "exposed": true,
          "relation": {
            "kind": "belongsTo",
            "target": "ShopCategory",
            "fkField": "categoryId"
          }
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
