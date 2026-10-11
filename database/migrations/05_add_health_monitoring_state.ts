import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('apis', (table) => {
        table
            .specificType('health_status', 'health_status')
            .notNullable()
            .defaultTo('DOWN');
        table.timestamp('last_health_check_at', { useTz: true }).nullable();
    });

    await knex.schema.alterTable('health_checks', (table) => {
        table.integer('attempt_count').notNullable().defaultTo(1);
        table.check(
            'attempt_count > 0',
            [],
            'health_checks_attempt_count_check',
        );
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(
        'ALTER TABLE health_checks DROP CONSTRAINT health_checks_attempt_count_check',
    );
    await knex.schema.alterTable('health_checks', (table) => {
        table.dropColumn('attempt_count');
    });

    await knex.schema.alterTable('apis', (table) => {
        table.dropColumn('last_health_check_at');
        table.dropColumn('health_status');
    });
}
