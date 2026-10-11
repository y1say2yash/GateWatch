import database from '../config/database.js';

import type { RateLimitConfig } from './rate-limit-types.js';

export const DEFAULT_RATE_LIMIT = {
    enabled: true,
    maxRequests: 100,
    windowSeconds: 60,
};

interface RateLimitConfigRow {
    api_id: string;
    enabled: boolean | null;
    request_limit: number | null;
    window_seconds: number | null;
}

export async function findGatewayRateLimitConfig(
    apiId: string,
): Promise<RateLimitConfig> {
    const row = await database<RateLimitConfigRow>('rate_limit_configs')
        .where({ api_id: apiId })
        .select(
            'api_id',
            'enabled',
            'request_limit',
            'window_seconds',
        )
        .first();

    return {
        apiId,
        enabled: row?.enabled ?? DEFAULT_RATE_LIMIT.enabled,
        maxRequests: row?.request_limit ?? DEFAULT_RATE_LIMIT.maxRequests,
        windowSeconds: row?.window_seconds ?? DEFAULT_RATE_LIMIT.windowSeconds,
    };
}

export async function findUserApiRateLimitConfig(
    userId: string,
    apiId: string,
): Promise<RateLimitConfig | null> {
    const row = await database<RateLimitConfigRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .leftJoin(
            'rate_limit_configs',
            'rate_limit_configs.api_id',
            'apis.id',
        )
        .where({
            'apis.id': apiId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select([
            'apis.id as api_id',
            'rate_limit_configs.enabled as enabled',
            'rate_limit_configs.request_limit as request_limit',
            'rate_limit_configs.window_seconds as window_seconds',
        ])
        .first();

    if (!row) {
        return null;
    }

    return {
        apiId: row.api_id,
        enabled: row.enabled ?? DEFAULT_RATE_LIMIT.enabled,
        maxRequests: row.request_limit ?? DEFAULT_RATE_LIMIT.maxRequests,
        windowSeconds: row.window_seconds ?? DEFAULT_RATE_LIMIT.windowSeconds,
    };
}

export async function updateUserApiRateLimitConfig(
    userId: string,
    apiId: string,
    config: Partial<Pick<
        RateLimitConfig,
        'enabled' | 'maxRequests' | 'windowSeconds'
    >>,
): Promise<RateLimitConfig | null> {
    return database.transaction(async (transaction) => {
        const api = await transaction('apis')
            .join('projects', 'projects.id', 'apis.project_id')
            .where({
                'apis.id': apiId,
                'projects.user_id': userId,
            })
            .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
            .whereNull('apis.deleted_at')
            .whereNull('projects.deleted_at')
            .select('apis.id')
            .first();

        if (!api) {
            return null;
        }

        const existing = await transaction<RateLimitConfigRow>(
            'rate_limit_configs',
        )
            .where({ api_id: apiId })
            .select(
                'api_id',
                'enabled',
                'request_limit',
                'window_seconds',
            )
            .first();
        const updated = {
            enabled: config.enabled ?? existing?.enabled ?? DEFAULT_RATE_LIMIT.enabled,
            maxRequests:
                config.maxRequests ??
                existing?.request_limit ??
                DEFAULT_RATE_LIMIT.maxRequests,
            windowSeconds:
                config.windowSeconds ??
                existing?.window_seconds ??
                DEFAULT_RATE_LIMIT.windowSeconds,
        };

        await transaction('rate_limit_configs')
            .insert({
                api_id: apiId,
                enabled: updated.enabled,
                request_limit: updated.maxRequests,
                window_seconds: updated.windowSeconds,
            })
            .onConflict('api_id')
            .merge({
                enabled: updated.enabled,
                request_limit: updated.maxRequests,
                window_seconds: updated.windowSeconds,
                updated_at: transaction.fn.now(),
            });

        return {
            apiId,
            ...updated,
        };
    });
}
