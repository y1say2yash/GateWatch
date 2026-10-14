import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE alert_events
        ADD COLUMN occurred_at TIMESTAMPTZ
    `);
    await knex.raw(`
        UPDATE alert_events
        SET occurred_at = CASE
            WHEN event_type = 'RECOVERED'
                THEN COALESCE(resolved_at, triggered_at)
            ELSE COALESCE(triggered_at, resolved_at)
        END
        WHERE occurred_at IS NULL
    `);
    await knex.raw(`
        ALTER TABLE alert_events
        ALTER COLUMN occurred_at SET NOT NULL,
        ALTER COLUMN triggered_at DROP NOT NULL
    `);
    await knex.raw(`
        CREATE INDEX alert_events_alert_id_occurred_at_index
        ON alert_events (alert_id, occurred_at DESC, id DESC)
    `);

    await knex.raw(`
        CREATE TYPE alert_runtime_state AS ENUM ('INACTIVE', 'TRIGGERED')
    `);
    await knex.raw(`
        ALTER TABLE alerts
        ADD COLUMN runtime_state alert_runtime_state NOT NULL DEFAULT 'INACTIVE',
        ADD COLUMN triggered_at TIMESTAMPTZ,
        ADD COLUMN recovered_at TIMESTAMPTZ
    `);

    await knex.raw(`
        WITH latest_transitions AS (
            SELECT DISTINCT ON (alert_id)
                alert_id,
                event_type
            FROM alert_events
            WHERE event_type IN ('TRIGGERED', 'RECOVERED')
            ORDER BY alert_id, occurred_at DESC, id DESC
        ),
        latest_triggers AS (
            SELECT DISTINCT ON (alert_id)
                alert_id,
                occurred_at
            FROM alert_events
            WHERE event_type = 'TRIGGERED'
            ORDER BY alert_id, occurred_at DESC, id DESC
        ),
        latest_recoveries AS (
            SELECT DISTINCT ON (alert_id)
                alert_id,
                occurred_at
            FROM alert_events
            WHERE event_type = 'RECOVERED'
            ORDER BY alert_id, occurred_at DESC, id DESC
        )
        UPDATE alerts
        SET runtime_state = CASE
                WHEN latest_transitions.event_type = 'TRIGGERED' THEN 'TRIGGERED'
                ELSE 'INACTIVE'
            END::alert_runtime_state,
            triggered_at = latest_triggers.occurred_at,
            recovered_at = latest_recoveries.occurred_at
        FROM latest_transitions
        LEFT JOIN latest_triggers
            ON latest_triggers.alert_id = latest_transitions.alert_id
        LEFT JOIN latest_recoveries
            ON latest_recoveries.alert_id = latest_transitions.alert_id
        WHERE alerts.id = latest_transitions.alert_id
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        UPDATE alert_events
        SET triggered_at = occurred_at
        WHERE triggered_at IS NULL
    `);
    await knex.raw(`
        ALTER TABLE alert_events
        ALTER COLUMN triggered_at SET NOT NULL
    `);
    await knex.raw(`
        DROP INDEX alert_events_alert_id_occurred_at_index
    `);
    await knex.schema.alterTable('alerts', (table) => {
        table.dropColumn('recovered_at');
        table.dropColumn('triggered_at');
        table.dropColumn('runtime_state');
    });
    await knex.schema.alterTable('alert_events', (table) => {
        table.dropColumn('occurred_at');
    });
    await knex.raw('DROP TYPE alert_runtime_state');
}
