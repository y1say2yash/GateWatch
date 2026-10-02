import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
    CREATE TYPE test_status AS ENUM (
      'ACTIVE',
      'DISABLED',
      'DELETED'
    );

    CREATE TYPE test_execution_status AS ENUM (
      'RUNNING',
      'PASSED',
      'FAILED',
      'ERROR'
    );

    CREATE TYPE health_status AS ENUM (
      'HEALTHY',
      'DEGRADED',
      'DOWN'
    );

    CREATE TYPE alert_type AS ENUM (
      'DOWN',
      'UNHEALTHY_DURATION',
      'ERROR_RATE',
      'LATENCY'
    );

    CREATE TYPE alert_status AS ENUM (
      'ACTIVE',
      'RESOLVED',
      'DISABLED',
      'DELETED'
    );
  `);

    await knex.schema.createTable('api_keys', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.string('key_hash', 255).notNullable().unique();
        table.timestamp('last_used_at', { useTz: true }).nullable();
        table.timestamp('revoked_at', { useTz: true }).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('api_id');
        table.index('revoked_at');
    });

    await knex.schema.createTable('rate_limit_configs', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .unique()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.boolean('enabled').notNullable().defaultTo(true);
        table.integer('request_limit').notNullable();
        table.integer('window_seconds').notNullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.check('request_limit > 0');
        table.check('window_seconds > 0');
    });

    await knex.schema.createTable('health_check_configs', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .unique()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.boolean('enabled').notNullable().defaultTo(true);
        table.string('path', 2048).notNullable().defaultTo('/');
        table.integer('interval_seconds').notNullable().defaultTo(60);
        table.integer('timeout_ms').notNullable().defaultTo(5000);
        table.integer('expected_status_min').notNullable().defaultTo(200);
        table.integer('expected_status_max').notNullable().defaultTo(299);
        table.integer('latency_threshold_ms').notNullable().defaultTo(1000);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.check('interval_seconds > 0');
        table.check('timeout_ms > 0');
        table.check('expected_status_min BETWEEN 100 AND 599');
        table.check('expected_status_max BETWEEN 100 AND 599');
        table.check('expected_status_min <= expected_status_max');
        table.check('latency_threshold_ms > 0');
    });

    await knex.schema.createTable('tests', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.string('method', 10).notNullable();
        table.string('path', 2048).notNullable();
        table.jsonb('headers').nullable();
        table.text('body').nullable();
        table.integer('timeout_ms').notNullable().defaultTo(5000);
        table.specificType('status', 'test_status').notNullable().defaultTo('ACTIVE');
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.check('timeout_ms > 0 AND timeout_ms <= 30000');
        table.check(`
      method IN (
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS'
      )
    `);

        table.index('api_id');
        table.index('status');
        table.index('deleted_at');
    });

    await knex.schema.createTable('test_executions', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('test_id')
            .notNullable()
            .references('id')
            .inTable('tests')
            .onDelete('CASCADE');

        table.specificType('status', 'test_execution_status').notNullable();
        table.integer('response_status').nullable();
        table.integer('response_time_ms').nullable();
        table.jsonb('response_headers').nullable();
        table.jsonb('response_body').nullable();
        table.jsonb('assertions').nullable();
        table.text('error_message').nullable();
        table.timestamp('started_at', { useTz: true }).notNullable();
        table.timestamp('completed_at', { useTz: true }).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('test_id');
        table.index('status');
        table.index('created_at');
    });

    await knex.schema.createTable('request_history', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.string('method', 10).notNullable();
        table.string('path', 2048).notNullable();
        table.integer('status_code').notNullable();
        table.integer('response_time_ms').nullable();
        table.string('client_ip', 45).nullable();
        table.uuid('api_key_id').nullable().references('id').inTable('api_keys').onDelete('SET NULL');
        table.jsonb('result').nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('api_id');
        table.index('created_at');
        table.index(['api_id', 'created_at']);
        table.index('status_code');
    });

    await knex.schema.createTable('health_checks', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.specificType('status', 'health_status').notNullable();
        table.integer('response_status').nullable();
        table.integer('response_time_ms').nullable();
        table.text('error_message').nullable();
        table.boolean('is_manual').notNullable().defaultTo(false);
        table.timestamp('checked_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('api_id');
        table.index(['api_id', 'checked_at']);
        table.index('status');
    });

    await knex.schema.createTable('alerts', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.specificType('type', 'alert_type').notNullable();
        table.specificType('status', 'alert_status').notNullable().defaultTo('ACTIVE');
        table.boolean('enabled').notNullable().defaultTo(true);
        table.integer('threshold').nullable();
        table.integer('duration_seconds').nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.index('api_id');
        table.index('type');
        table.index('status');
        table.index('deleted_at');
    });

    await knex.schema.createTable('alert_events', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('alert_id')
            .notNullable()
            .references('id')
            .inTable('alerts')
            .onDelete('CASCADE');

        table.string('event_type', 50).notNullable();
        table.text('message').nullable();
        table.jsonb('metadata').nullable();
        table.timestamp('triggered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('resolved_at', { useTz: true }).nullable();

        table.index('alert_id');
        table.index('triggered_at');
    });

    await knex.schema.createTable('audit_logs', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

        table
            .uuid('user_id')
            .nullable()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL');

        table.string('action', 100).notNullable();
        table.string('resource_type', 100).notNullable();
        table.uuid('resource_id').nullable();
        table.jsonb('details').nullable();
        table.string('ip_address', 45).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('user_id');
        table.index(['resource_type', 'resource_id']);
        table.index('created_at');
        table.index('action');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('audit_logs');
    await knex.schema.dropTableIfExists('alert_events');
    await knex.schema.dropTableIfExists('alerts');
    await knex.schema.dropTableIfExists('health_checks');
    await knex.schema.dropTableIfExists('request_history');
    await knex.schema.dropTableIfExists('test_executions');
    await knex.schema.dropTableIfExists('tests');
    await knex.schema.dropTableIfExists('health_check_configs');
    await knex.schema.dropTableIfExists('rate_limit_configs');
    await knex.schema.dropTableIfExists('api_keys');

    await knex.raw(`
    DROP TYPE IF EXISTS alert_status;
    DROP TYPE IF EXISTS alert_type;
    DROP TYPE IF EXISTS health_status;
    DROP TYPE IF EXISTS test_execution_status;
    DROP TYPE IF EXISTS test_status;
  `);
}