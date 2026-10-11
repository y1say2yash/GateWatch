import database from '../config/database.js';
import { sanitizeAuditMetadata } from '../audit/audit-service.js';

import type { AuditLogEntry, AuditLogFilters } from './admin-types.js';

interface AuditLogRow {
    id: string;
    user_id: string | null;
    actor_role: string | null;
    action: string;
    resource_type: string;
    resource_id: string | null;
    details: Record<string, unknown> | null;
    ip_address: string | null;
    created_at: Date;
}

function mapAuditLog(row: AuditLogRow): AuditLogEntry {
    return {
        id: row.id,
        userId: row.user_id,
        actorRole: row.actor_role,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: sanitizeAuditMetadata(row.details),
        ipAddress: row.ip_address,
        createdAt: row.created_at.toISOString(),
    };
}

export async function findAuditLogs(
    filters: AuditLogFilters,
): Promise<{ data: AuditLogEntry[]; total: number }> {
    const countQuery = database('audit_logs');
    if (filters.from) {
        countQuery.where('created_at', '>=', filters.from);
    }
    if (filters.to) {
        countQuery.where('created_at', '<=', filters.to);
    }
    const count = await countQuery
        .count<{ count: string }>({ count: 'id' })
        .first();

    const rowsQuery = database<AuditLogRow>('audit_logs');
    if (filters.from) {
        rowsQuery.where('created_at', '>=', filters.from);
    }
    if (filters.to) {
        rowsQuery.where('created_at', '<=', filters.to);
    }
    const rows = await rowsQuery
        .select([
            'id',
            'user_id',
            'actor_role',
            'action',
            'resource_type',
            'resource_id',
            'details',
            'ip_address',
            'created_at',
        ])
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);

    return {
        data: rows.map(mapAuditLog),
        total: Number(count?.count ?? 0),
    };
}
