import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw('LOCK TABLE test_executions IN ACCESS EXCLUSIVE MODE');

    const storedResponses = await knex('test_executions')
        .whereNotNull('response_body')
        .orWhereNotNull('response_headers')
        .first('id');

    if (storedResponses) {
        throw new Error(
            'Migration 08 cannot remove legacy response columns because test_executions contains response data. Preserve and review those records before retrying; the migration transaction rolled back without schema changes.',
        );
    }

    await knex.schema.alterTable('tests', (table) => {
        table.text('url').nullable();
        table.jsonb('authentication').nullable();
        table.jsonb('assertions').notNullable().defaultTo('[]');
    });

    await knex.schema.alterTable('test_executions', (table) => {
        table.dropColumn('response_body');
        table.dropColumn('response_headers');
    });
}

export async function down(knex: Knex): Promise<void> {
    const populatedDefinitions = await knex('tests')
        .whereNotNull('url')
        .orWhereNotNull('authentication')
        .orWhereRaw(`assertions <> '[]'::jsonb`)
        .first('id');
    if (populatedDefinitions) {
        throw new Error(
            'Migration 08 cannot be rolled back while test definitions contain URLs, authentication, or assertions; preserve or explicitly migrate those values first.',
        );
    }

    await knex.schema.alterTable('tests', (table) => {
        table.dropColumn('assertions');
        table.dropColumn('authentication');
        table.dropColumn('url');
    });

    await knex.schema.alterTable('test_executions', (table) => {
        table.jsonb('response_body').nullable();
        table.jsonb('response_headers').nullable();
    });
}
