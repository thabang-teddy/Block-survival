import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'auth_access_tokens';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.integer('tokenable_id').notNullable().unsigned().references('users.id').onDelete('CASCADE');
            table.string('type').notNullable();
            table.string('name').nullable();
            table.string('hash').notNullable();
            table.text('abilities').notNullable();
            table.integer('device_id').unsigned().nullable().references('devices.id').onDelete('CASCADE');
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').notNullable();
            table.timestamp('last_used_at').nullable();
            table.timestamp('expires_at').nullable();
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0003_create_auth_access_tokens_table.js.map