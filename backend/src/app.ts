import express from 'express';
import cookieParser from 'cookie-parser';

import database from './config/database.js';
import redis from './config/redis.js';
import authRoutes from './auth/auth-routes.js';

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/api/v1/auth', authRoutes);

app.get('/api/health', async (_req, res) => {
    const dependencies = {
        postgres: 'unknown',
        redis: 'unknown',
    };

    try {
        await database.raw('SELECT 1');
        dependencies.postgres = 'ok';
    } catch {
        dependencies.postgres = 'error';
    }

    try {
        await redis.ping();
        dependencies.redis = 'ok';
    } catch {
        dependencies.redis = 'error';
    }

    const healthy =
        dependencies.postgres === 'ok' &&
        dependencies.redis === 'ok';

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        dependencies,
    });
});

export default app;