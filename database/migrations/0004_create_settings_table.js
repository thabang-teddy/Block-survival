import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'settings';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('key', 64).primary();
            table.text('value').notNullable();
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').nullable();
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0004_create_settings_table.js.map