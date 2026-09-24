import { BaseSchema } from '@adonisjs/lucid/schema';
export default class extends BaseSchema {
    tableName = 'saves';
    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id').notNullable();
            table.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
            table.string('kind', 8).notNullable().defaultTo('own');
            table.text('payload', 'longtext').notNullable();
            table.integer('size').unsigned().notNullable();
            table.integer('night').unsigned().notNullable().defaultTo(0);
            table.integer('seconds').unsigned().notNullable().defaultTo(0);
            table.integer('players').unsigned().notNullable().defaultTo(1);
            table.timestamp('created_at').notNullable();
            table.timestamp('updated_at').nullable();
            table.unique(['user_id', 'kind']);
        });
    }
    async down() {
        this.schema.dropTable(this.tableName);
    }
}
//# sourceMappingURL=0009_create_saves_table.js.map