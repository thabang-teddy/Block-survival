import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'users';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.string('name').notNullable();
            table.string('email', 254).notNullable().unique();
            table.string('password').notNullable();
            table.boolean('is_admin').notNullable().defaultTo(false);
            table.boolean('is_disabled').notNullable().defaultTo(false);
            table.timestamp('last_login_at').nullable();
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').nullable();
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0001_create_users_table.js.map