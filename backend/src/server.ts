import app from './app.js';
import database from './config/database.js';
import redis from './config/redis.js';
import {
    startHealthScheduler,
    stopHealthScheduler,
} from './health/health-scheduler.js';

const PORT = Number(process.env.BACKEND_PORT ?? 4000);

async function startServer() {
    try {
        await database.raw('SELECT 1');
        console.log('PostgreSQL connected');

        await redis.connect();
        await redis.ping();
        console.log('Redis connected');

        const server = app.listen(PORT, () => {
            console.log(`Backend listening on port ${PORT}`);
            startHealthScheduler();
        });

        let shuttingDown = false;
        const shutdown = async (signal: NodeJS.Signals) => {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            console.log(`Received ${signal}; stopping backend`);

            try {
                await stopHealthScheduler();
                await new Promise<void>((resolve, reject) => {
                    server.close((error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
                if (redis.isOpen) {
                    await redis.quit();
                }
                await database.destroy();
            } catch (error) {
                console.error('Backend shutdown failed:', error);
                process.exitCode = 1;
            }
        };

        process.once('SIGINT', () => {
            void shutdown('SIGINT');
        });
        process.once('SIGTERM', () => {
            void shutdown('SIGTERM');
        });
    } catch (error) {
        console.error('Failed to start backend:', error);
        process.exit(1);
    }
}

startServer();