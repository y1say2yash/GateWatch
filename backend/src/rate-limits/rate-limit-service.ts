import redis from '../config/redis.js';

import {
    findGatewayRateLimitConfig,
    findUserApiRateLimitConfig,
    updateUserApiRateLimitConfig,
} from './rate-limit-repository.js';

import type {
    RateLimitConfig,
    RateLimitDecision,
} from './rate-limit-types.js';

const FIXED_WINDOW_SCRIPT = `
local now = redis.call('TIME')
local nowSeconds = tonumber(now[1])
local windowSeconds = tonumber(ARGV[1])
local windowStart = nowSeconds - (nowSeconds % windowSeconds)
local resetAt = windowStart + windowSeconds
local counterKey = KEYS[1] .. ':' .. tostring(windowStart)
local count = redis.call('INCR', counterKey)

if count == 1 then
    redis.call('EXPIREAT', counterKey, resetAt)
end

return {count, resetAt}
`;

export class RateLimitUnavailableError extends Error {
    constructor(message: string, cause: unknown) {
        super(message, { cause });
        this.name = 'RateLimitUnavailableError';
    }
}

export class RateLimitConfigNotFoundError extends Error {
    constructor() {
        super('API not found.');
        this.name = 'RateLimitConfigNotFoundError';
    }
}

export async function getGatewayRateLimitConfig(
    apiId: string,
): Promise<RateLimitConfig> {
    try {
        return await findGatewayRateLimitConfig(apiId);
    } catch (error) {
        throw new RateLimitUnavailableError(
            'Failed to load rate-limit configuration.',
            error,
        );
    }
}

export async function getUserApiRateLimitConfig(
    userId: string,
    apiId: string,
): Promise<RateLimitConfig> {
    const config = await findUserApiRateLimitConfig(userId, apiId);

    if (!config) {
        throw new RateLimitConfigNotFoundError();
    }

    return config;
}

export async function setUserApiRateLimitConfig(
    userId: string,
    apiId: string,
    input: Partial<Pick<
        RateLimitConfig,
        'enabled' | 'maxRequests' | 'windowSeconds'
    >>,
): Promise<RateLimitConfig> {
    const updated = await updateUserApiRateLimitConfig(
        userId,
        apiId,
        input,
    );

    if (!updated) {
        throw new RateLimitConfigNotFoundError();
    }

    return updated;
}

export async function consumeGatewayRateLimit(
    apiId: string,
    clientIdentity: string,
    config: RateLimitConfig,
): Promise<RateLimitDecision> {
    const identity = encodeURIComponent(clientIdentity);
    const keyPrefix = `gatewatch:rate-limit:v1:${apiId}:${identity}`;

    let result: unknown;

    try {
        result = await redis.eval(FIXED_WINDOW_SCRIPT, {
            keys: [keyPrefix],
            arguments: [String(config.windowSeconds)],
        });
    } catch (error) {
        throw new RateLimitUnavailableError(
            'Failed to enforce gateway rate limit.',
            error,
        );
    }

    if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        !Number.isSafeInteger(Number(result[0])) ||
        !Number.isSafeInteger(Number(result[1]))
    ) {
        throw new RateLimitUnavailableError(
            'Redis returned an invalid rate-limit counter.',
            result,
        );
    }

    const count = Number(result[0]);
    const resetAt = Number(result[1]);

    return {
        allowed: count <= config.maxRequests,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt,
    };
}
