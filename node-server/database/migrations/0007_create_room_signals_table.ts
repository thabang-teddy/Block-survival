import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * WebRTC signalling mailbox for native clients that host peer-to-peer: peers POST
 * offers, answers and candidates and poll for the ones addressed to them.
 */
export default class extends BaseSchema {
  protected tableName = 'room_signals'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('room_code', 6).notNullable()
      table.string('from_peer', 64).notNullable()
      table.string('to_peer', 64).notNullable()
      table.string('type', 16).notNullable()
      table.text('data').notNullable()
      table.timestamp('created_at').notNullable().index()
      // the poll: WHERE room_code = ? AND to_peer = ? AND id > ? ORDER BY id
      table.index(['room_code', 'to_peer', 'id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
