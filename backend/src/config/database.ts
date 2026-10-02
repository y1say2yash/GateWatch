import knex from 'knex';

const database = knex({
    client: 'pg',
    connection: {
        host: process.env.POSTGRES_HOST ?? 'postgres',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'gatewatch',
        user: process.env.POSTGRES_USER ?? 'gatewatch',
        password: process.env.POSTGRES_PASSWORD ?? 'gatewatch_dev',
    },
    pool: {
        min: 2,
        max: 10,
    },
});

export default database;