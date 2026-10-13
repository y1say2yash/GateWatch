import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'test_trigger_type') THEN
                CREATE TYPE test_trigger_type AS ENUM ('MANUAL');
            END IF;
        END $$;
    `);

    await knex.raw(`
        ALTER TABLE test_executions
        ADD COLUMN IF NOT EXISTS trigger_type test_trigger_type NOT NULL DEFAULT 'MANUAL';
    `);

    await knex.raw(`
        ALTER TABLE test_executions
        ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL;
    `);

    await knex.raw(`
        ALTER TABLE test_executions
        ADD COLUMN IF NOT EXISTS result JSONB NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    const existingExecution = await knex('test_executions').select('id').first();
    if (existingExecution) {
        throw new Error(
            'Migration 09 cannot be rolled back while test_executions contains records because the execution metadata would be lost. Preserve or explicitly migrate those records before retrying.',
        );
    }

    await knex.raw(`
        ALTER TABLE test_executions
        DROP COLUMN IF EXISTS result;
    `);

    await knex.raw(`
        ALTER TABLE test_executions
        DROP COLUMN IF EXISTS duration_ms;
    `);

    await knex.raw(`
        ALTER TABLE test_executions
        DROP COLUMN IF EXISTS trigger_type;
    `);

    // This type may have existed before migration 09; retain it rather than dropping a shared type.
}
