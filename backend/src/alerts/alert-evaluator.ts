import database from '../config/database.js';
import type { Knex } from 'knex';
import type { HealthCheckRecord, HealthStatus } from '../health/health-types.js';
import { findOwnedHealthHistory, findOwnedHealthStatus } from '../health/health-repository.js';
import type { MonitoringSummary } from '../monitoring/monitoring-types.js';
import { buildMonitoringSummary } from '../monitoring/monitoring-service.js';
import { findOwnedApiMonitoringRows } from '../monitoring/monitoring-repository.js';
import type { Alert } from './alert-types.js';
import { findOwnedAlert } from './alert-repository.js';

export interface AlertEvaluationContext {
    apiStatus: string | null;
    healthStatus: HealthStatus | null;
    latestHealthCheck: HealthCheckRecord | null;
    healthHistory: HealthCheckRecord[];
    healthCheckIntervalSeconds: number;
    monitoringSummary: MonitoringSummary | null;
    now: Date;
}

export interface AlertEvaluationResult {
    alertId: string;
    apiId: string;
    type: Alert['type'];
    active: boolean;
    evaluatedAt: string;
    reason: string;
    details?: Record<string, unknown>;
}

function isVisibleApiStatus(status: string | null): boolean {
    return status === 'REGISTERED' || status === 'ACTIVE' || status === 'DISABLED';
}

function parseTimestamp(value: string | Date | null | undefined): number | null {
    if (!value) {
        return null;
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

function evaluateApiDown(
    context: AlertEvaluationContext,
): boolean {
    if (!isVisibleApiStatus(context.apiStatus)) {
        return false;
    }
    if (context.apiStatus === 'DISABLED') {
        return false;
    }
    if (context.healthStatus !== 'DOWN') {
        return false;
    }
    if (!context.latestHealthCheck) {
        return false;
    }
    const observedAt = parseTimestamp(context.latestHealthCheck.checkedAt);
    return observedAt !== null;
}

function evaluateUnhealthyDuration(
    config: { durationSeconds: number },
    context: AlertEvaluationContext,
): boolean {
    if (!isVisibleApiStatus(context.apiStatus) || context.apiStatus === 'DISABLED') {
        return false;
    }

    const history = context.healthHistory
        .slice()
        .sort((left, right) => {
            const leftTime = parseTimestamp(left.checkedAt) ?? Number.NEGATIVE_INFINITY;
            const rightTime = parseTimestamp(right.checkedAt) ?? Number.NEGATIVE_INFINITY;
            return leftTime - rightTime;
        });

    if (history.length === 0) {
        return false;
    }

    const gapToleranceMs = Math.max(
        2 * 60_000,
        context.healthCheckIntervalSeconds * 2_000,
    );
    let streakStart: number | null = null;
    let previousTimestamp: number | null = null;

    for (const record of history) {
        const checkedAt = parseTimestamp(record.checkedAt);
        if (checkedAt === null) {
            continue;
        }

        if (record.status === 'HEALTHY') {
            streakStart = null;
            previousTimestamp = null;
            continue;
        }

        if (streakStart === null) {
            streakStart = checkedAt;
        } else if (previousTimestamp !== null) {
            const gap = checkedAt - previousTimestamp;
            if (gap > gapToleranceMs) {
                streakStart = checkedAt;
            }
        }

        previousTimestamp = checkedAt;
    }

    if (streakStart === null) {
        return false;
    }

    const durationMs = config.durationSeconds * 1_000;
    return context.now.getTime() - streakStart >= durationMs;
}

function evaluateErrorRate(
    config: { threshold: number; windowSeconds: number },
    context: AlertEvaluationContext,
): boolean {
    if (!context.monitoringSummary) {
        return false;
    }
    if (context.monitoringSummary.totalRequests === 0) {
        return false;
    }
    return context.monitoringSummary.errorRate > config.threshold;
}

function evaluateLatency(
    config: { thresholdMs: number; windowSeconds: number },
    context: AlertEvaluationContext,
): boolean {
    if (!context.monitoringSummary) {
        return false;
    }
    if (context.monitoringSummary.averageLatencyMs === null) {
        return false;
    }
    return context.monitoringSummary.averageLatencyMs > config.thresholdMs;
}

export function evaluateAlertCondition(
    alert: Alert,
    context: AlertEvaluationContext,
): boolean {
    if (!alert.enabled) {
        return false;
    }
    if (alert.type === 'API_DOWN') {
        return evaluateApiDown(context);
    }
    if (alert.type === 'UNHEALTHY_DURATION') {
        return evaluateUnhealthyDuration(
            alert.configuration as { durationSeconds: number },
            context,
        );
    }
    if (alert.type === 'ERROR_RATE') {
        return evaluateErrorRate(
            alert.configuration as { threshold: number; windowSeconds: number },
            context,
        );
    }
    return evaluateLatency(
        alert.configuration as { thresholdMs: number; windowSeconds: number },
        context,
    );
}

async function buildEvaluationContext(
    userId: string,
    alert: Alert,
    now: Date,
    connection: Knex | Knex.Transaction = database,
): Promise<AlertEvaluationContext> {
    const [apiStatusRow, healthStatus, history, intervalSecondsRow] = await Promise.all([
        connection('apis')
            .join('projects', 'projects.id', 'apis.project_id')
            .where({
                'apis.id': alert.apiId,
                'projects.user_id': userId,
            })
            .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
            .whereNull('apis.deleted_at')
            .whereNull('projects.deleted_at')
            .select('apis.status', 'apis.health_status')
            .first(),
        findOwnedHealthStatus(userId, alert.apiId, connection),
        findOwnedHealthHistory(userId, alert.apiId, 100, connection),
        connection('health_check_configs')
            .join('apis', 'apis.id', 'health_check_configs.api_id')
            .join('projects', 'projects.id', 'apis.project_id')
            .where({
                'apis.id': alert.apiId,
                'projects.user_id': userId,
            })
            .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
            .whereNull('apis.deleted_at')
            .whereNull('projects.deleted_at')
            .select('health_check_configs.interval_seconds as interval_seconds')
            .first(),
    ]);

    const apiStatus = apiStatusRow?.status ?? null;
    const healthStatusValue = healthStatus?.healthStatus ?? null;
    const healthHistory = history ?? [];
    const healthCheckIntervalSeconds = intervalSecondsRow?.interval_seconds ?? 60;
    const monitoringSummary =
        alert.type === 'ERROR_RATE' || alert.type === 'LATENCY'
            ? await (async () => {
                const config = alert.configuration as { windowSeconds: number };
                const from = new Date(now.getTime() - config.windowSeconds * 1_000);
                const rows = await findOwnedApiMonitoringRows(
                    userId,
                    alert.apiId,
                    { from, to: now },
                    connection,
                );
                return rows ? buildMonitoringSummary(alert.apiId, { from, to: now }, rows) : null;
            })()
            : null;

    return {
        apiStatus,
        healthStatus: healthStatusValue,
        latestHealthCheck: healthHistory.length > 0 ? healthHistory[0] : null,
        healthHistory,
        healthCheckIntervalSeconds,
        monitoringSummary,
        now,
    };
}

export async function evaluateAlertForOwnedAlert(
    userId: string,
    alert: Alert,
    now: Date = new Date(),
    connection: Knex | Knex.Transaction = database,
): Promise<AlertEvaluationResult> {
    const context = await buildEvaluationContext(userId, alert, now, connection);
    const active = evaluateAlertCondition(alert, context);

    return {
        alertId: alert.id,
        apiId: alert.apiId,
        type: alert.type,
        active,
        evaluatedAt: now.toISOString(),
        reason: active ? 'Condition satisfied.' : 'Condition not satisfied.',
        details: {
            apiStatus: context.apiStatus,
            healthStatus: context.healthStatus,
            summary: context.monitoringSummary,
        },
    };
}

export async function evaluateUserAlert(
    userId: string,
    alertId: string,
    now: Date = new Date(),
    connection: Knex | Knex.Transaction = database,
): Promise<AlertEvaluationResult> {
    const alert = await findOwnedAlert(userId, alertId, connection);
    if (!alert) {
        throw new Error('Alert not found.');
    }
    return evaluateAlertForOwnedAlert(userId, alert, now, connection);
}
