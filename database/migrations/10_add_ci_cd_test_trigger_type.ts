import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TYPE test_trigger_type
        ADD VALUE IF NOT EXISTS 'CI_CD';
    `);
}

export async function down(): Promise<void> {
    // PostgreSQL cannot safely remove an enum label while stored rows may use it.
    throw new Error(
        'Migration 10 cannot remove CI_CD while test executions may reference it. Roll forward instead.',
    );
}
