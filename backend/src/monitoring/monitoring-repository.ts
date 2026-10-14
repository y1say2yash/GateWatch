import database from '../config/database.js';
import type { Knex } from 'knex';

import type {
    MonitoringDateRange,
    MonitoringStatusRow,
} from './monitoring-types.js';

export async function findOwnedApiMonitoringRows(
    userId: string,
    apiId: string,
    range: MonitoringDateRange,
    connection: Knex | Knex.Transaction = database,
): Promise<MonitoringStatusRow[] | null> {
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

    if (!ownedApi) {
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
