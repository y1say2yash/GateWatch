export interface AuditLogFilters {
    page: number;
    limit: number;
    from?: Date;
    to?: Date;
}

export interface AuditLogEntry {
    id: string;
    userId: string | null;
    actorRole: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    details: Record<string, string | number | boolean | null> | null;
    ipAddress: string | null;
    createdAt: string;
}
