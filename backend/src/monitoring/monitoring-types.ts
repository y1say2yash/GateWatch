export interface MonitoringDateRange {
    from?: Date;
    to?: Date;
}

export interface MonitoringStatusRow {
    status_code: number;
    request_count?: string | number;
    latency_count?: string | number;
    average_latency?: string | number | null;
}

export interface MonitoringSummary {
    apiId: string;
    period: {
        from: string | null;
        to: string | null;
    };
    totalRequests: number;
    statusCodeCounts: Record<string, number>;
    averageLatencyMs: number | null;
    errorCount: number;
    errorRate: number;
}
