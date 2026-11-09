import {migrations} from '@getcronit/pylon/db'

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
          "nullable": false,
          "check": "char_length(\"name\") >= 2"
        }
      ]
    }),
    migrations.createTable({
      "name": "Book",
      "table": "book",
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
      "table": "book",
      "name": "book_author_id_fkey",
      "column": "author_id",
      "refTable": "author",
      "refColumn": "id"
    })
  ]
})
