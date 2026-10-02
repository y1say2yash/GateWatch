import type { Knex } from 'knex';

const config: Record<string, Knex.Config> = {
    development: {
        client: 'pg',
        connection: {
            host: process.env.POSTGRES_HOST ?? 'postgres',
            port: Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB ?? 'gatewatch',
            user: process.env.POSTGRES_USER ?? 'gatewatch',
            password: process.env.POSTGRES_PASSWORD ?? 'gatewatch_dev',
        },
        migrations: {
            directory: '/database/migrations',
            extension: 'ts',
        },
        seeds: {
            directory: '/database/seeds',
            extension: 'ts',
        },
    },
};

export default config;