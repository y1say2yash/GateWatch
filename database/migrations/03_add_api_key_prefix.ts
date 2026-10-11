
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('api_keys', (table) => {
        table.string('key_prefix', 16).nullable();
    });

    await knex.schema.alterTable('api_keys', (table) => {
        table.index(
            ['api_id', 'revoked_at'],
            'api_keys_api_id_revoked_at_index',
        );
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('api_keys', (table) => {
        table.dropIndex(
            ['api_id', 'revoked_at'],
            'api_keys_api_id_revoked_at_index',
        );
        table.dropColumn('key_prefix');
    });
}
