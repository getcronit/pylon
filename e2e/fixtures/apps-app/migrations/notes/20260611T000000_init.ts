import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  operations: [
    migrations.createTable({
      name: 'Note',
      table: 'notes_note',
      columns: [
        {
          property: 'id',
          name: 'id',
          sqlType: 'bigint',
          primaryKey: true,
          autoIncrement: true,
          unique: false,
          nullable: false
        },
        {
          property: 'title',
          name: 'title',
          sqlType: 'text',
          primaryKey: false,
          autoIncrement: false,
          unique: false,
          nullable: false
        },
        {
          property: 'ownerId',
          name: 'owner_id',
          sqlType: 'integer',
          primaryKey: false,
          autoIncrement: false,
          unique: false,
          nullable: false
        },
        {
          property: 'shared',
          name: 'shared',
          sqlType: 'boolean',
          primaryKey: false,
          autoIncrement: false,
          unique: false,
          nullable: false,
          default: false
        }
      ]
    })
  ]
})
