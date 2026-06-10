import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "Author",
      "table": "blog_author",
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
      "name": "Article",
      "table": "blog_article",
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
      "table": "blog_article",
      "name": "blog_article_author_id_fkey",
      "column": "author_id",
      "refTable": "blog_author",
      "refColumn": "id"
    })
  ]
})
