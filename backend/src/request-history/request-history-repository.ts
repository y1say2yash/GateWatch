import database from '../config/database.js';

import type {
    RequestHistoryFilters,
    RequestHistoryRecord,
} from './request-history-types.js';

interface RequestHistoryRow {
    id: string;
    api_id: string;
    route_id: string | null;
    method: string;
    path: string;
    status_code: number;
    response_time_ms: number | null;
    client_identity: string | null;
    created_at: Date;
    result: Record<string, string> | null;
}

const SENSITIVE_PATH_KEY =
    /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|session[-_]?id|authorization|password|secret|token)$/i;
const JWT_PATH_SEGMENT =
    /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const API_KEY_PATH_SEGMENT = /^gw_[A-Za-z0-9_-]{20,}$/;
const OPAQUE_PATH_SEGMENT = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{40,}$/;
const UUID_PATH_SEGMENT =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeRequestHistoryPath(path: string): string {
    const segments = path.split('/');

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const separatorIndex = segment.search(/[=:]/);
        const key =
            separatorIndex === -1
                ? segment
                : segment.slice(0, separatorIndex);

        if (SENSITIVE_PATH_KEY.test(key)) {
            if (separatorIndex === -1) {
                if (index + 1 < segments.length) {
                    segments[index + 1] = '[REDACTED]';
                }
            } else {
                segments[index] = `${key}=[REDACTED]`;
            }
            continue;
        }

        if (
            JWT_PATH_SEGMENT.test(segment) ||
            API_KEY_PATH_SEGMENT.test(segment) ||
            (!UUID_PATH_SEGMENT.test(segment) &&
                OPAQUE_PATH_SEGMENT.test(segment))
        ) {
            segments[index] = '[REDACTED]';
        }
    }

    return segments.join('/');
}

function mapRequestHistory(row: RequestHistoryRow): RequestHistoryRecord {
    return {
        requestId: row.id,
        apiId: row.api_id,
        routeId: row.route_id,
        method: row.method,
        path: row.path,
        statusCode: row.status_code,
        latencyMs: row.response_time_ms,
        clientIdentity: row.client_identity,
        timestamp: row.created_at.toISOString(),
        result: row.result,
    };
}

export async function recordGatewayRequest(input: {
    requestId: string;
    apiId: string;
    routeId: string;
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
    clientIdentity: string | null;
    timestamp: Date;
    result: Record<string, string>;
}): Promise<void> {
    await database('request_history').insert({
        id: input.requestId,
        api_id: input.apiId,
        route_id: input.routeId,
        method: input.method,
        path: sanitizeRequestHistoryPath(input.path),
        status_code: input.statusCode,
        response_time_ms: input.latencyMs,
        client_identity: input.clientIdentity,
        created_at: input.timestamp,
        result: input.result,
    });
}

function applyFilters(
    query: ReturnType<typeof database>,
    apiId: string,
    filters: RequestHistoryFilters,
) {
    query.where('request_history.api_id', apiId);

    if (filters.statusCode !== undefined) {
        query.where('request_history.status_code', filters.statusCode);
    }
    if (filters.method !== undefined) {
        query.where('request_history.method', filters.method);
    }
    if (filters.from) {
        query.where('request_history.created_at', '>=', filters.from);
    }
    if (filters.to) {
        query.where('request_history.created_at', '<=', filters.to);
    }

    return query;
}

export async function findOwnedApiRequestHistory(
    userId: string,
    apiId: string,
    filters: RequestHistoryFilters,
): Promise<{ data: RequestHistoryRecord[]; total: number } | null> {
    const ownedApi = await database('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'projects.user_id': userId,
            'apis.id': apiId,
        })
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('apis.id')
        .first();

    if (!ownedApi) {
        return null;
    }

    const ownershipQuery = () =>
        database<RequestHistoryRow>('request_history')
            .join('apis', 'apis.id', 'request_history.api_id')
            .join('projects', 'projects.id', 'apis.project_id')
            .where({
                'projects.user_id': userId,
                'apis.id': apiId,
            })
            .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
            .whereNull('apis.deleted_at')
            .whereNull('projects.deleted_at');

    const countResult = await applyFilters(
        ownershipQuery(),
        apiId,
        filters,
    )
        .count<{ count: string }>({ count: 'request_history.id' })
        .first();

    const rows = await applyFilters(
        ownershipQuery(),
        apiId,
        filters,
    )
        .select([
            'request_history.id',
            'request_history.api_id',
            'request_history.route_id',
            'request_history.method',
            'request_history.path',
            'request_history.status_code',
            'request_history.response_time_ms',
            'request_history.client_identity',
            'request_history.created_at',
            'request_history.result',
        ])
        .orderBy('request_history.created_at', filters.order)
        .orderBy('request_history.id', filters.order)
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);

    const total = Number(countResult?.count ?? 0);
    return {
        data: rows.map(mapRequestHistory),
        total,
    };
}

export async function findOwnedRequestHistoryRecord(
    userId: string,
    requestId: string,
): Promise<RequestHistoryRecord | null> {
    const row = await database<RequestHistoryRow>('request_history')
        .join('apis', 'apis.id', 'request_history.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'request_history.id': requestId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select([
            'request_history.id',
            'request_history.api_id',
            'request_history.route_id',
            'request_history.method',
            'request_history.path',
            'request_history.status_code',
            'request_history.response_time_ms',
            'request_history.client_identity',
            'request_history.created_at',
            'request_history.result',
        ])
        .first();

    return row ? mapRequestHistory(row) : null;
}
