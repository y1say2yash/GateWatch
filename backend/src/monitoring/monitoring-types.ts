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

export type MonitoringBucketSize = 'hour' | 'day';

export interface MonitoringTimeSeriesPoint {
    bucketStart: string;
    requestCount: number;
    statusCounts: {
        informational: number;
        successful: number;
        redirection: number;
        clientError: number;
        serverError: number;
        other: number;
    };
    latencyCount: number;
    averageLatencyMs: number | null;
}

export interface MonitoringTimeSeriesRow {
    bucket_start: Date | string;
    request_count: string | number;
    informational_count: string | number;
    successful_count: string | number;
    redirection_count: string | number;
    client_error_count: string | number;
    server_error_count: string | number;
    other_count: string | number;
    latency_count: string | number;
    average_latency: string | number | null;
}

export interface MonitoringTimeSeries {
    apiId: string;
    period: {
        from: string;
        to: string;
    };
    bucketSize: MonitoringBucketSize;
    buckets: MonitoringTimeSeriesPoint[];
}
