import { BaseSchema } from '@adonisjs/lucid/schema'

/** one row per browser (encrypted cookie) or native client (its own token) that has signed in */
export default class extends BaseSchema {
  protected tableName = 'devices'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('token', 64).notNullable().unique()
      table.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE')
      table.string('label', 40).nullable()
      table.string('user_agent', 255).nullable()
      table.string('ip', 45).nullable()
      table.timestamp('last_seen_at').nullable()
      table.timestamp('approved_at').nullable().index()
      table.integer('approved_by').unsigned().nullable().references('users.id').onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
