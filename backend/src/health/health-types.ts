export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface HealthCheckConfig {
    apiId: string;
    enabled: boolean;
    path: string;
    intervalSeconds: number;
    timeoutMs: number;
    expectedStatusMin: number;
    expectedStatusMax: number;
    latencyThresholdMs: number;
}

export interface HealthCheckTarget {
    id: string;
    upstreamUrl: string;
    upstreamBasePath: string | null;
    status: string;
    healthStatus: HealthStatus;
    lastHealthCheckAt: Date | null;
}

export interface HealthCheckResult {
    apiId: string;
    status: HealthStatus;
    responseTimeMs: number | null;
    httpStatus: number | null;
    attemptCount: number;
    errorMessage: string | null;
    isManual: boolean;
    checkedAt: string;
}

export interface HealthCheckRecord extends HealthCheckResult {
    id: string;
}

export interface HealthStatusResult {
    apiId: string;
    healthStatus: HealthStatus;
    lastHealthCheckAt: string | null;
    latestCheck: HealthCheckRecord | null;
}

export interface HealthCheckExecution {
    httpStatus: number | null;
    responseTimeMs: number | null;
    attemptCount: number;
    status: HealthStatus;
    errorMessage: string | null;
}
