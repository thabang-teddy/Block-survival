import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'room_signals';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.string('room_code', 6).notNullable();
            table.string('from_peer', 64).notNullable();
            table.string('to_peer', 64).notNullable();
            table.string('type', 16).notNullable();
            table.text('data').notNullable();
            table.timestamp('created_at').notNullable().index();
            table.index(['room_code', 'to_peer', 'id']);
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0007_create_room_signals_table.js.map