import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'rooms';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.string('code', 6).notNullable().unique();
            table.string('host_peer_id', 128).notNullable();
            table.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
            table.string('host_name', 16).notNullable();
            table.string('world_kind', 8).notNullable().defaultTo('own');
            table.integer('players').unsigned().notNullable().defaultTo(1);
            table.timestamp('expires_at').notNullable().index();
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').nullable();
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0005_create_rooms_table.js.map