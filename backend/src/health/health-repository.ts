import database from '../config/database.js';
import type { Knex } from 'knex';

import type {
    HealthCheckRecord,
    HealthCheckResult,
    HealthStatusResult,
} from './health-types.js';

interface HealthCheckRow {
    id: string;
    api_id: string;
    status: HealthCheckRecord['status'];
    response_time_ms: number | null;
    response_status: number | null;
    attempt_count: number;
    error_message: string | null;
    is_manual: boolean;
    checked_at: Date;
}

interface ApiHealthRow {
    id: string;
    health_status: HealthStatusResult['healthStatus'];
    last_health_check_at: Date | null;
}

function mapHealthCheck(row: HealthCheckRow): HealthCheckRecord {
    return {
        id: row.id,
        apiId: row.api_id,
        status: row.status,
        responseTimeMs: row.response_time_ms,
        httpStatus: row.response_status,
        attemptCount: row.attempt_count,
        errorMessage: row.error_message,
        isManual: row.is_manual,
        checkedAt: row.checked_at.toISOString(),
    };
}

export async function persistHealthCheck(
    result: HealthCheckResult,
): Promise<HealthCheckRecord> {
    const checkedAt = new Date(result.checkedAt);

    return database.transaction(async (transaction) => {
        const [row] = await transaction<HealthCheckRow>('health_checks')
            .insert({
                api_id: result.apiId,
                status: result.status,
                response_time_ms: result.responseTimeMs,
                response_status: result.httpStatus,
                attempt_count: result.attemptCount,
                error_message: result.errorMessage,
                is_manual: result.isManual,
                checked_at: checkedAt,
            })
            .returning('*');

        const updatedApis = await transaction('apis')
            .where({
                id: result.apiId,
            })
            .whereNull('deleted_at')
            .update({
                health_status: result.status,
                last_health_check_at: checkedAt,
            });

        if (updatedApis !== 1) {
            throw new Error(
                `API ${result.apiId} was unavailable while saving its health check.`,
            );
        }

        return mapHealthCheck(row);
    });
}

export async function findOwnedHealthStatus(
    userId: string,
    apiId: string,
    connection: Knex | Knex.Transaction = database,
): Promise<HealthStatusResult | null> {
    const api = await connection<ApiHealthRow>('apis')
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
            'apis.health_status',
            'apis.last_health_check_at',
        ])
        .first();

    if (!api) {
        return null;
    }

    const latest = await connection<HealthCheckRow>('health_checks')
        .where({ api_id: apiId })
        .orderBy('checked_at', 'desc')
        .orderBy('id', 'desc')
        .first();

    return {
        apiId,
        healthStatus: api.health_status,
        lastHealthCheckAt: api.last_health_check_at?.toISOString() ?? null,
        latestCheck: latest ? mapHealthCheck(latest) : null,
    };
}

export async function findOwnedHealthHistory(
    userId: string,
    apiId: string,
    limit: number,
    connection: Knex | Knex.Transaction = database,
): Promise<HealthCheckRecord[] | null> {
    const api = await connection('apis')
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

    const rows = await connection<HealthCheckRow>('health_checks')
        .where({ api_id: apiId })
        .orderBy('checked_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit);

    return rows.map(mapHealthCheck);
}
