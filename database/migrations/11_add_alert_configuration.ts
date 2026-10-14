import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'API_DOWN'
    `);
    await knex.schema.alterTable('alerts', (table) => {
        table.jsonb('configuration').notNullable().defaultTo('{}');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('alerts', (table) => {
        table.dropColumn('configuration');
    });
    await knex.raw(`
        ALTER TYPE alert_type RENAME TO alert_type_with_api_down;
        CREATE TYPE alert_type AS ENUM (
            'DOWN',
            'UNHEALTHY_DURATION',
            'ERROR_RATE',
            'LATENCY'
        );
        ALTER TABLE alerts
            ALTER COLUMN type TYPE alert_type
            USING (
                CASE
                    WHEN type::text = 'API_DOWN' THEN 'DOWN'
                    ELSE type::text
                END
            )::alert_type;
        DROP TYPE alert_type_with_api_down;
    `);
}
