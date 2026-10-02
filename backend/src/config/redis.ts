import { createClient } from 'redis';

const redis = createClient({
    url: `redis://${process.env.REDIS_HOST ?? 'redis'}:${process.env.REDIS_PORT ?? 6379}`,
});

redis.on('error', (error) => {
    console.error('Redis client error:', error);
});

export default redis;