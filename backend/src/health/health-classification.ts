import type {
    HealthCheckConfig,
    HealthStatus,
} from './health-types.js';

export function classifyHealthCheck(
    httpStatus: number | null,
    responseTimeMs: number | null,
    attemptCount: number,
    config: HealthCheckConfig,
): HealthStatus {
    const successfulResponse =
        httpStatus !== null &&
        httpStatus >= config.expectedStatusMin &&
        httpStatus <= config.expectedStatusMax;

    if (!successfulResponse) {
        return 'DOWN';
    }

    if (
        attemptCount > 1 ||
        responseTimeMs === null ||
        responseTimeMs > config.latencyThresholdMs
    ) {
        return 'DEGRADED';
    }

    return 'HEALTHY';
}
