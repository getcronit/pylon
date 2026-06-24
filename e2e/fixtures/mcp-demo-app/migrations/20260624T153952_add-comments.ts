import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  dependencies: ["20260624T153827_initial"],
  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)
  // operations for data migrations (each with a `down` to stay reversible).
  operations: [
    migrations.createTable({
      "name": "Comment",
      "table": "comment",
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
          "property": "body",
          "name": "body",
          "sqlType": "text",
          "primaryKey": false,
          "autoIncrement": false,
          "unique": false,
          "nullable": false
        },
        {
          "property": "postId",
          "name": "post_id",
          "sqlType": "bigint",
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
      "table": "comment",
      "name": "comment_post_id_fkey",
      "column": "post_id",
      "refTable": "post",
      "refColumn": "id"
    }),
    migrations.addForeignKey({
      "table": "comment",
      "name": "comment_author_id_fkey",
      "column": "author_id",
      "refTable": "author",
      "refColumn": "id"
    })
  ]
})
