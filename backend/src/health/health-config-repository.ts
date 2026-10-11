import database from '../config/database.js';

import type {
    HealthCheckConfig,
    HealthCheckTarget,
    HealthStatus,
} from './health-types.js';

export const DEFAULT_HEALTH_CHECK_CONFIG = {
    enabled: true,
    path: '/',
    intervalSeconds: 60,
    timeoutMs: 5_000,
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    latencyThresholdMs: 1_000,
};

interface HealthCheckConfigRow {
    api_id: string;
    enabled: boolean | null;
    path: string | null;
    interval_seconds: number | null;
    timeout_ms: number | null;
    expected_status_min: number | null;
    expected_status_max: number | null;
    latency_threshold_ms: number | null;
}

interface HealthTargetRow {
    id: string;
    upstream_url: string;
    upstream_base_path: string | null;
    status: string;
    health_status: HealthStatus;
    last_health_check_at: Date | null;
    config_enabled?: boolean | null;
    config_path?: string | null;
    config_interval_seconds?: number | null;
    config_timeout_ms?: number | null;
    config_expected_status_min?: number | null;
    config_expected_status_max?: number | null;
    config_latency_threshold_ms?: number | null;
}

function mapConfig(
    row: HealthCheckConfigRow | undefined,
    apiId: string,
): HealthCheckConfig {
    return {
        apiId,
        enabled: row?.enabled ?? DEFAULT_HEALTH_CHECK_CONFIG.enabled,
        path: row?.path ?? DEFAULT_HEALTH_CHECK_CONFIG.path,
        intervalSeconds:
            row?.interval_seconds ??
            DEFAULT_HEALTH_CHECK_CONFIG.intervalSeconds,
        timeoutMs: row?.timeout_ms ?? DEFAULT_HEALTH_CHECK_CONFIG.timeoutMs,
        expectedStatusMin:
            row?.expected_status_min ??
            DEFAULT_HEALTH_CHECK_CONFIG.expectedStatusMin,
        expectedStatusMax:
            row?.expected_status_max ??
            DEFAULT_HEALTH_CHECK_CONFIG.expectedStatusMax,
        latencyThresholdMs:
            row?.latency_threshold_ms ??
            DEFAULT_HEALTH_CHECK_CONFIG.latencyThresholdMs,
    };
}

export async function findOwnedHealthCheckConfig(
    userId: string,
    apiId: string,
): Promise<HealthCheckConfig | null> {
    const row = await database<HealthCheckConfigRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .leftJoin(
            'health_check_configs',
            'health_check_configs.api_id',
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
            'health_check_configs.enabled as enabled',
            'health_check_configs.path as path',
            'health_check_configs.interval_seconds as interval_seconds',
            'health_check_configs.timeout_ms as timeout_ms',
            'health_check_configs.expected_status_min as expected_status_min',
            'health_check_configs.expected_status_max as expected_status_max',
            'health_check_configs.latency_threshold_ms as latency_threshold_ms',
        ])
        .first();

    return row ? mapConfig(row, row.api_id) : null;
}

export async function updateOwnedHealthCheckConfig(
    userId: string,
    apiId: string,
    updates: Partial<Omit<HealthCheckConfig, 'apiId'>>,
): Promise<HealthCheckConfig | null> {
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

        const existing = await transaction<HealthCheckConfigRow>(
            'health_check_configs',
        )
            .where({ api_id: apiId })
            .select(
                'api_id',
                'enabled',
                'path',
                'interval_seconds',
                'timeout_ms',
                'expected_status_min',
                'expected_status_max',
                'latency_threshold_ms',
            )
            .first();
        const current = mapConfig(existing, apiId);
        const updated = { ...current, ...updates };
        const row = {
            api_id: apiId,
            enabled: updated.enabled,
            path: updated.path,
            interval_seconds: updated.intervalSeconds,
            timeout_ms: updated.timeoutMs,
            expected_status_min: updated.expectedStatusMin,
            expected_status_max: updated.expectedStatusMax,
            latency_threshold_ms: updated.latencyThresholdMs,
        };

        await transaction('health_check_configs')
            .insert(row)
            .onConflict('api_id')
            .merge({
                enabled: row.enabled,
                path: row.path,
                interval_seconds: row.interval_seconds,
                timeout_ms: row.timeout_ms,
                expected_status_min: row.expected_status_min,
                expected_status_max: row.expected_status_max,
                latency_threshold_ms: row.latency_threshold_ms,
                updated_at: transaction.fn.now(),
            });

        return updated;
    });
}

export async function findOwnedHealthTarget(
    userId: string,
    apiId: string,
): Promise<HealthCheckTarget | null> {
    const row = await database<HealthTargetRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.id': apiId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select([
            'apis.id',
            'apis.upstream_url',
            'apis.upstream_base_path',
            'apis.status',
            'apis.health_status',
            'apis.last_health_check_at',
        ])
        .first();

    return row
        ? {
            id: row.id,
            upstreamUrl: row.upstream_url,
            upstreamBasePath: row.upstream_base_path,
            status: row.status,
            healthStatus: row.health_status,
            lastHealthCheckAt: row.last_health_check_at,
        }
        : null;
}

export async function findScheduledHealthChecks(): Promise<Array<{
    target: HealthCheckTarget;
    config: HealthCheckConfig;
}>> {
    const rows = await database<HealthTargetRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .leftJoin(
            'health_check_configs',
            'health_check_configs.api_id',
            'apis.id',
        )
        .where('apis.status', 'ACTIVE')
        .where('projects.status', 'ACTIVE')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .whereRaw('COALESCE(health_check_configs.enabled, true) = true')
        .select([
            'apis.id',
            'apis.upstream_url',
            'apis.upstream_base_path',
            'apis.status',
            'apis.health_status',
            'apis.last_health_check_at',
            'health_check_configs.enabled as config_enabled',
            'health_check_configs.path as config_path',
            'health_check_configs.interval_seconds as config_interval_seconds',
            'health_check_configs.timeout_ms as config_timeout_ms',
            'health_check_configs.expected_status_min as config_expected_status_min',
            'health_check_configs.expected_status_max as config_expected_status_max',
            'health_check_configs.latency_threshold_ms as config_latency_threshold_ms',
        ]);

    return rows.map((row) => {
        const configRow: HealthCheckConfigRow = {
            api_id: row.id,
            enabled: row.config_enabled ?? null,
            path: row.config_path ?? null,
            interval_seconds: row.config_interval_seconds ?? null,
            timeout_ms: row.config_timeout_ms ?? null,
            expected_status_min: row.config_expected_status_min ?? null,
            expected_status_max: row.config_expected_status_max ?? null,
            latency_threshold_ms: row.config_latency_threshold_ms ?? null,
        };

        return {
            target: {
                id: row.id,
                upstreamUrl: row.upstream_url,
                upstreamBasePath: row.upstream_base_path,
                status: row.status,
                healthStatus: row.health_status,
                lastHealthCheckAt: row.last_health_check_at,
            },
            config: mapConfig(configRow, row.id),
        };
    });
}
