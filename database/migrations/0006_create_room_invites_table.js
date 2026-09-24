import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'room_invites';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.integer('room_id').unsigned().notNullable().references('rooms.id').onDelete('CASCADE');
            table.integer('from_user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
            table.integer('to_user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
            table.string('status', 8).notNullable().defaultTo('pending');
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').nullable();
            table.unique(['room_id', 'to_user_id']);
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0006_create_room_invites_table.js.map