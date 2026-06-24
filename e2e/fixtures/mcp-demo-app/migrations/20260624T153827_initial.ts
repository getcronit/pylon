import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "Author",
      "table": "author",
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
          "unique": false,
          "nullable": false
        }
      ]
    }),
    migrations.createTable({
      "name": "Post",
      "table": "post",
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
          "property": "body",
          "name": "body",
          "sqlType": "text",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        },
        {
          "property": "published",
          "name": "published",
          "sqlType": "boolean",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false,
          "default": false
        },
        {
          "property": "authorId",
          "name": "author_id",
          "sqlType": "bigint",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        }
      ]
    }),
    migrations.addForeignKey({
      "table": "post",
      "name": "post_author_id_fkey",
      "column": "author_id",
      "refTable": "author",
      "refColumn": "id"
    }),
    migrations.addIndex({
      "name": "post_author_id_idx",
      "table": "post",
      "columns": [
        "author_id"
      ],
      "unique": false
    })
  ]
})
