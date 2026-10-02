import app from './app.js';
import database from './config/database.js';
import redis from './config/redis.js';

const PORT = Number(process.env.BACKEND_PORT ?? 4000);

async function startServer() {
    try {
        await database.raw('SELECT 1');
        console.log('PostgreSQL connected');

        await redis.connect();
        await redis.ping();
        console.log('Redis connected');

        app.listen(PORT, () => {
            console.log(`Backend listening on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start backend:', error);
        process.exit(1);
    }
}

startServer();