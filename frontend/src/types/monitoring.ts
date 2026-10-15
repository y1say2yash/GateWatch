import type { Api, ApiRoute, HealthStatus, Project } from './management';

export interface GatewayRoute {
  project: Project;
  api: Api;
  route: ApiRoute;
}

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
  from?: string;
  to?: string;
  sort: 'timestamp';
  order: 'asc' | 'desc';
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

export interface MonitoringTimeSeries {
  apiId: string;
  period: {
    from: string;
    to: string;
  };
  bucketSize: MonitoringBucketSize;
  buckets: MonitoringTimeSeriesPoint[];
}

export interface ApiHealthStatus {
  apiId: string;
  healthStatus: HealthStatus;
  lastHealthCheckAt: string | null;
  latestCheck: {
    id: string;
    apiId: string;
    status: HealthStatus;
    responseTimeMs: number | null;
    httpStatus: number | null;
    attemptCount: number;
    errorMessage: string | null;
    isManual: boolean;
    checkedAt: string;
  } | null;
}

export interface ApiHealthHistoryEntry {
  id: string;
  apiId: string;
  status: HealthStatus;
  responseTimeMs: number | null;
  httpStatus: number | null;
  attemptCount: number;
  errorMessage: string | null;
  isManual: boolean;
  checkedAt: string;
}

export interface ApiHealthConfiguration {
  apiId: string;
  enabled: boolean;
  path: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  latencyThresholdMs: number;
}

export interface ApiHealthOverviewEntry {
  api: Api;
  project: Project;
  status: ApiHealthStatus;
  configuration: ApiHealthConfiguration;
}
