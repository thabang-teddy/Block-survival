import { BaseSchema } from '@adonisjs/lucid/schema'

/** a host asking a player into their room (issue #5) */
export default class extends BaseSchema {
  protected tableName = 'room_invites'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('room_id').unsigned().notNullable().references('rooms.id').onDelete('CASCADE')
      table.integer('from_user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.integer('to_user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      // pending | accepted | declined
      table.string('status', 8).notNullable().defaultTo('pending')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.unique(['room_id', 'to_user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
