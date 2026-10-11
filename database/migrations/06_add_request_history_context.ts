import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('request_history', (table) => {
        table
            .uuid('route_id')
            .nullable()
            .references('id')
            .inTable('api_routes')
            .onDelete('SET NULL');
        table.text('client_identity').nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('request_history', (table) => {
        table.dropColumn('route_id');
        table.dropColumn('client_identity');
    });
}
