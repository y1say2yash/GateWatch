export interface RequestHistoryRecord {
    requestId: string;
    apiId: string;
    routeId: string | null;
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number | null;
    clientIdentity: string | null;
    timestamp: string;
    result: Record<string, string> | null;
}

export interface RequestHistoryFilters {
    page: number;
    limit: number;
    statusCode?: number;
    method?: string;
    from?: Date;
    to?: Date;
    sort: 'timestamp';
    order: 'asc' | 'desc';
}
