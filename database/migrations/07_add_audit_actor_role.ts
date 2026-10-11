import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('audit_logs', (table) => {
        table.string('actor_role', 20).nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('audit_logs', (table) => {
        table.dropColumn('actor_role');
    });
}
