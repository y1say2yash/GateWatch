import type { Knex } from 'knex';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(
    new URL('../database/migrations', import.meta.url),
);
const seedsDirectory = fileURLToPath(
    new URL('../database/seeds', import.meta.url),
);

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
            directory: migrationsDirectory,
            extension: 'ts',
        },
        seeds: {
            directory: seedsDirectory,
            extension: 'ts',
        },
    },
};

export default config;