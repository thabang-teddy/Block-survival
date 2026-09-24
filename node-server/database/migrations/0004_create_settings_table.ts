import { BaseSchema } from '@adonisjs/lucid/schema'

/** admin-editable key/value pairs (login window, game rules); see app/models/setting.ts */
export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 64).primary()
      table.text('value').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
