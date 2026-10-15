import database from '../config/database.js';
import type { Knex } from 'knex';

import type {
    MonitoringBucketSize,
    MonitoringDateRange,
    MonitoringStatusRow,
    MonitoringTimeSeriesRow,
} from './monitoring-types.js';

async function findOwnedApi(
    userId: string,
    apiId: string,
    connection: Knex | Knex.Transaction,
): Promise<boolean> {
    const ownedApi = await connection('apis')
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

    return Boolean(ownedApi);
}

export async function findOwnedApiMonitoringRows(
    userId: string,
    apiId: string,
    range: MonitoringDateRange,
    connection: Knex | Knex.Transaction = database,
): Promise<MonitoringStatusRow[] | null> {
    if (!await findOwnedApi(userId, apiId, connection)) {
        return null;
    }

    const query = connection<MonitoringStatusRow>('request_history')
        .where('api_id', apiId);
    if (range.from) {
        query.where('created_at', '>=', range.from);
    }
    if (range.to) {
        query.where('created_at', '<=', range.to);
    }

    return query
        .select('status_code')
        .count({ request_count: 'id' })
        .count({ latency_count: 'response_time_ms' })
        .avg({ average_latency: 'response_time_ms' })
        .groupBy('status_code')
        .orderBy('status_code', 'asc');
}

export async function findOwnedApiMonitoringTimeSeriesRows(
    userId: string,
    apiId: string,
    range: Required<MonitoringDateRange>,
    bucketSize: MonitoringBucketSize,
    connection: Knex | Knex.Transaction = database,
): Promise<MonitoringTimeSeriesRow[] | null> {
    if (!await findOwnedApi(userId, apiId, connection)) {
        return null;
    }

    const interval = bucketSize === 'hour' ? '1 hour' : '1 day';
    const result = await connection.raw<{ rows: MonitoringTimeSeriesRow[] }>(
        `SELECT
            date_bin(?::interval, request_history.created_at, ?::timestamptz) AS bucket_start,
            COUNT(*) AS request_count,
            COUNT(*) FILTER (WHERE status_code >= 100 AND status_code < 200) AS informational_count,
            COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300) AS successful_count,
            COUNT(*) FILTER (WHERE status_code >= 300 AND status_code < 400) AS redirection_count,
            COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS client_error_count,
            COUNT(*) FILTER (WHERE status_code >= 500 AND status_code < 600) AS server_error_count,
            COUNT(*) FILTER (WHERE status_code < 100 OR status_code >= 600) AS other_count,
            COUNT(response_time_ms) AS latency_count,
            AVG(response_time_ms) AS average_latency
        FROM request_history
        WHERE api_id = ?
            AND created_at >= ?
            AND created_at <= ?
        GROUP BY bucket_start
        ORDER BY bucket_start ASC`,
        [interval, '2000-01-01T00:00:00.000Z', apiId, range.from, range.to],
    );
    return result.rows;
}
