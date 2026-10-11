import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('apis', (table) => {
        table
            .boolean('auth_required')
            .notNullable()
            .defaultTo(false);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('apis', (table) => {
        table.dropColumn('auth_required');
    });
}