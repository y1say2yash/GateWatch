import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await knex.raw(`
    CREATE TYPE user_status AS ENUM (
      'ACTIVE',
      'DELETED',
      'ADMIN_DISABLED'
    );

    CREATE TYPE project_status AS ENUM (
      'ACTIVE',
      'DELETED'
    );

    CREATE TYPE api_status AS ENUM (
      'REGISTERED',
      'ACTIVE',
      'DISABLED',
      'DELETED'
    );
  `);

    await knex.schema.createTable('users', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.bigInteger('github_id').notNullable().unique();
        table.string('github_username', 255).notNullable().unique();
        table.string('email', 320).unique();
        table.string('avatar_url', 2048).nullable();
        table.specificType('status', 'user_status').notNullable().defaultTo('ACTIVE');
        table.boolean('is_admin').notNullable().defaultTo(false);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.index('status');
        table.index('deleted_at');
    });

    await knex.schema.createTable('sessions', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');

        table.string('token_hash', 255).notNullable().unique();
        table.timestamp('expires_at', { useTz: true }).notNullable();
        table.timestamp('revoked_at', { useTz: true, }).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('user_id');
        table.index('expires_at');
        table.index(['revoked_at'], 'sessions_revoked_at_index');
    });

    await knex.schema.createTable('access_tokens', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.string('token_hash', 255).notNullable().unique();
        table.timestamp('expires_at', { useTz: true }).nullable();
        table.timestamp('last_used_at', { useTz: true }).nullable();
        table.timestamp('revoked_at', { useTz: true }).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.index('user_id');
        table.index('revoked_at');
    });

    await knex.schema.createTable('projects', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.string('slug', 100).notNullable();
        table.text('description').nullable();
        table.specificType('status', 'project_status').notNullable().defaultTo('ACTIVE');
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.unique('slug');
        table.index('user_id');
        table.index('status');
        table.index('deleted_at');
    });

    await knex.schema.createTable('apis', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table
            .uuid('project_id')
            .notNullable()
            .references('id')
            .inTable('projects')
            .onDelete('CASCADE');

        table.string('name', 100).notNullable();
        table.text('description').nullable();
        table.string('upstream_url', 2048).notNullable();
        table.string('upstream_base_path', 2048).nullable();
        table.specificType('status', 'api_status').notNullable().defaultTo('REGISTERED');
        table.integer('version').notNullable().defaultTo(1);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.unique(['project_id', 'name']);
        table.index('project_id');
        table.index('status');
        table.index('deleted_at');
    });

    await knex.schema.createTable('api_routes', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table
            .uuid('api_id')
            .notNullable()
            .references('id')
            .inTable('apis')
            .onDelete('CASCADE');

        table.string('path_prefix', 2048).notNullable();
        table.string('method', 10).notNullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true }).nullable();

        table.unique(['api_id', 'path_prefix', 'method']);
        table.index('api_id');
        table.index(['path_prefix', 'method']);
        table.index('deleted_at');
    });

    await knex.raw(`
    ALTER TABLE api_routes
    ADD CONSTRAINT api_routes_method_check
    CHECK (method IN (
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS'
    ));
  `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('api_routes');
    await knex.schema.dropTableIfExists('apis');
    await knex.schema.dropTableIfExists('projects');
    await knex.schema.dropTableIfExists('access_tokens');
    await knex.schema.dropTableIfExists('sessions');
    await knex.schema.dropTableIfExists('users');

    await knex.raw(`
    DROP TYPE IF EXISTS api_status;
    DROP TYPE IF EXISTS project_status;
    DROP TYPE IF EXISTS user_status;
  `);
}