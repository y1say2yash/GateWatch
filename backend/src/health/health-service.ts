import {
    findOwnedHealthCheckConfig,
    findOwnedHealthTarget,
    findScheduledHealthChecks,
    updateOwnedHealthCheckConfig,
} from './health-config-repository.js';
import {
    findOwnedHealthHistory,
    findOwnedHealthStatus,
    persistHealthCheck,
} from './health-repository.js';
import { classifyHealthCheck } from './health-classification.js';

import type {
    HealthCheckConfig,
    HealthCheckExecution,
    HealthCheckRecord,
    HealthCheckResult,
    HealthCheckTarget,
    HealthStatus,
} from './health-types.js';
import type { HealthCheckConfigUpdate } from './health-validation.js';
import {
    HealthConfigValidationError,
    validateCombinedStatusRange,
} from './health-validation.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_CHECKS = 10;
const HEALTH_CHECK_LOCKS = new Set<string>();

let activeCheckCount = 0;
interface ConcurrencyWaiter {
    resolve: () => void;
    signal?: AbortSignal;
    abortListener?: () => void;
}
const concurrencyWaiters: ConcurrencyWaiter[] = [];

class ScheduledCheckCancelledError extends Error {
    constructor() {
        super('Scheduled health check was cancelled.');
        this.name = 'ScheduledCheckCancelledError';
    }
}

export class HealthApiNotFoundError extends Error {
    constructor() {
        super('API not found.');
        this.name = 'HealthApiNotFoundError';
    }
}

export class HealthApiNotActiveError extends Error {
    constructor() {
        super('Health checks can only be run for active APIs.');
        this.name = 'HealthApiNotActiveError';
    }
}

export class HealthCheckDisabledError extends Error {
    constructor() {
        super('Health checks are disabled for this API.');
        this.name = 'HealthCheckDisabledError';
    }
}

export class HealthCheckAlreadyRunningError extends Error {
    constructor() {
        super('A health check is already running for this API.');
        this.name = 'HealthCheckAlreadyRunningError';
    }
}

export class HealthMonitoringUnavailableError extends Error {
    constructor(message: string, cause: unknown) {
        super(message, { cause });
        this.name = 'HealthMonitoringUnavailableError';
    }
}

async function acquireConcurrencySlot(
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted) {
        throw new ScheduledCheckCancelledError();
    }

    if (activeCheckCount >= MAX_CONCURRENT_CHECKS) {
        await new Promise<void>((resolve, reject) => {
            const waiter: ConcurrencyWaiter = {
                resolve,
                signal,
            };
            if (signal) {
                waiter.abortListener = () => {
                    const index = concurrencyWaiters.indexOf(waiter);
                    if (index !== -1) {
                        concurrencyWaiters.splice(index, 1);
                        reject(new ScheduledCheckCancelledError());
                    }
                };
                signal.addEventListener('abort', waiter.abortListener, {
                    once: true,
                });
            }
            concurrencyWaiters.push(waiter);
        });
        return;
    }

    activeCheckCount += 1;
}

function releaseConcurrencySlot(): void {
    const nextWaiter = concurrencyWaiters.shift();
    if (nextWaiter) {
        if (nextWaiter.signal && nextWaiter.abortListener) {
            nextWaiter.signal.removeEventListener(
                'abort',
                nextWaiter.abortListener,
            );
        }
        nextWaiter.resolve();
    } else {
        activeCheckCount -= 1;
    }
}

function buildHealthCheckUrl(
    target: HealthCheckTarget,
    config: HealthCheckConfig,
): URL {
    const upstream = new URL(target.upstreamUrl);
    const basePath = target.upstreamBasePath?.trim() ?? '';
    const healthPath = config.path;
    const normalizedBasePath = basePath
        ? `/${basePath.replace(/^\/+|\/+$/g, '')}`
        : '';
    const normalizedHealthPath =
        healthPath === '/'
            ? ''
            : `/${healthPath.replace(/^\/+/, '')}`;

    upstream.pathname =
        `${normalizedBasePath}${normalizedHealthPath}` || '/';
    upstream.search = '';
    upstream.hash = '';

    return upstream;
}

interface AttemptResult {
    httpStatus: number | null;
    responseTimeMs: number | null;
    errorMessage: string | null;
    successful: boolean;
}

async function performAttempt(
    url: URL,
    config: HealthCheckConfig,
): Promise<AttemptResult> {
    const startedAt = Date.now();
    const abortController = new AbortController();
    const timeout = setTimeout(
        () => abortController.abort(),
        Math.min(config.timeoutMs, DEFAULT_TIMEOUT_MS),
    );

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: abortController.signal,
            headers: {
                accept: '*/*',
                'user-agent': 'GateWatch-Health-Check',
            },
        });
        const responseTimeMs = Date.now() - startedAt;
        const successful =
            response.status >= config.expectedStatusMin &&
            response.status <= config.expectedStatusMax;

        if (response.body) {
            void response.body.cancel().catch(() => undefined);
        }

        return {
            httpStatus: response.status,
            responseTimeMs,
            errorMessage: successful
                ? null
                : `Upstream returned HTTP ${response.status}.`,
            successful,
        };
    } catch (error) {
        const timedOut =
            abortController.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError');

        return {
            httpStatus: null,
            responseTimeMs: Date.now() - startedAt,
            errorMessage: timedOut
                ? 'Health-check attempt timed out.'
                : 'Unable to connect to upstream API.',
            successful: false,
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function checkUpstream(
    target: HealthCheckTarget,
    config: HealthCheckConfig,
): Promise<HealthCheckExecution> {
    const url = buildHealthCheckUrl(target, config);
    const startedAt = Date.now();
    let finalAttempt = await performAttempt(url, config);
    let attempts = 1;

    if (!finalAttempt.successful) {
        finalAttempt = await performAttempt(url, config);
        attempts += 1;
    }

    const responseTimeMs = Date.now() - startedAt;
    const status: HealthStatus = classifyHealthCheck(
        finalAttempt.httpStatus,
        responseTimeMs,
        attempts,
        config,
    );
    const errorMessage =
        status === 'HEALTHY'
            ? null
            : finalAttempt.successful
                ? 'Retry succeeded after an initial failed attempt.'
                : finalAttempt.errorMessage ??
                'Health check did not meet the configured success criteria.';

    return {
        status,
        httpStatus: finalAttempt.httpStatus,
        responseTimeMs,
        attemptCount: attempts,
        errorMessage,
    };
}

async function withConcurrencySlot<T>(
    action: () => Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    await acquireConcurrencySlot(signal);
    try {
        if (signal?.aborted) {
            throw new ScheduledCheckCancelledError();
        }
        return await action();
    } finally {
        releaseConcurrencySlot();
    }
}

async function runCheck(
    target: HealthCheckTarget,
    config: HealthCheckConfig,
    isManual: boolean,
    skipIfRunning: boolean,
    signal?: AbortSignal,
): Promise<HealthCheckRecord | null> {
    if (signal?.aborted) {
        return null;
    }

    if (HEALTH_CHECK_LOCKS.has(target.id)) {
        if (skipIfRunning) {
            return null;
        }
        throw new HealthCheckAlreadyRunningError();
    }

    HEALTH_CHECK_LOCKS.add(target.id);

    try {
        return await withConcurrencySlot(async () => {
            const execution = await checkUpstream(target, config);
            const result: HealthCheckResult = {
                apiId: target.id,
                ...execution,
                isManual,
                checkedAt: new Date().toISOString(),
            };

            try {
                return await persistHealthCheck(result);
            } catch (error) {
                throw new HealthMonitoringUnavailableError(
                    'Failed to persist health-check result.',
                    error,
                );
            }
        }, signal);
    } finally {
        HEALTH_CHECK_LOCKS.delete(target.id);
    }
}

type ScheduledHealthCheck = Awaited<
    ReturnType<typeof findScheduledHealthChecks>
>[number];

function healthCheckDueAt(
    item: ScheduledHealthCheck,
    fallbackTime: number,
): number {
    const lastCheckAt = item.target.lastHealthCheckAt?.getTime();
    return lastCheckAt === undefined
        ? fallbackTime
        : lastCheckAt + item.config.intervalSeconds * 1_000;
}

export function isScheduledHealthCheckDue(
    item: ScheduledHealthCheck,
    now: number,
): boolean {
    return healthCheckDueAt(item, now) <= now;
}

export function getNextHealthCheckDelay(
    scheduled: ScheduledHealthCheck[],
    now: number,
    nextCheckAt: ReadonlyMap<string, number> = new Map(),
): number {
    if (scheduled.length === 0) {
        return HEALTH_CHECK_INTERVAL_MS;
    }

    const nextDueAt = scheduled.reduce((earliest, item) => {
        const dueAt =
            nextCheckAt.get(item.target.id) ??
            healthCheckDueAt(item, now);
        return Math.min(earliest, dueAt);
    }, Number.POSITIVE_INFINITY);

    return Math.max(0, nextDueAt - now);
}

export async function getUserHealthCheckConfig(
    userId: string,
    apiId: string,
): Promise<HealthCheckConfig> {
    try {
        const config = await findOwnedHealthCheckConfig(userId, apiId);

        if (!config) {
            throw new HealthApiNotFoundError();
        }

        return config;
    } catch (error) {
        if (error instanceof HealthApiNotFoundError) {
            throw error;
        }
        throw new HealthMonitoringUnavailableError(
            'Failed to load health-check configuration.',
            error,
        );
    }
}

export async function patchUserHealthCheckConfig(
    userId: string,
    apiId: string,
    updates: HealthCheckConfigUpdate,
): Promise<HealthCheckConfig> {
    try {
        const current = await findOwnedHealthCheckConfig(userId, apiId);

        if (!current) {
            throw new HealthApiNotFoundError();
        }

        validateCombinedStatusRange(current, updates);
        const config = await updateOwnedHealthCheckConfig(
            userId,
            apiId,
            updates,
        );

        if (!config) {
            throw new HealthApiNotFoundError();
        }

        return config;
    } catch (error) {
        if (
            error instanceof HealthApiNotFoundError ||
            error instanceof HealthConfigValidationError
        ) {
            throw error;
        }
        throw new HealthMonitoringUnavailableError(
            'Failed to update health-check configuration.',
            error,
        );
    }
}

export async function runUserHealthCheck(
    userId: string,
    apiId: string,
): Promise<HealthCheckRecord> {
    let target: HealthCheckTarget | null;
    let config: HealthCheckConfig | null;

    try {
        [target, config] = await Promise.all([
            findOwnedHealthTarget(userId, apiId),
            findOwnedHealthCheckConfig(userId, apiId),
        ]);
    } catch (error) {
        throw new HealthMonitoringUnavailableError(
            'Failed to load API health-check information.',
            error,
        );
    }

    if (!target || !config) {
        throw new HealthApiNotFoundError();
    }

    if (target.status !== 'ACTIVE') {
        throw new HealthApiNotActiveError();
    }
    if (!config.enabled) {
        throw new HealthCheckDisabledError();
    }

    const result = await runCheck(target, config, true, false);

    if (!result) {
        throw new HealthMonitoringUnavailableError(
            'Manual health check was skipped.',
            null,
        );
    }

    return result;
}

export async function getUserHealthStatus(
    userId: string,
    apiId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof findOwnedHealthStatus>>>> {
    try {
        const status = await findOwnedHealthStatus(userId, apiId);
        if (!status) {
            throw new HealthApiNotFoundError();
        }
        return status;
    } catch (error) {
        if (error instanceof HealthApiNotFoundError) {
            throw error;
        }
        throw new HealthMonitoringUnavailableError(
            'Failed to load API health status.',
            error,
        );
    }
}

export async function getUserHealthHistory(
    userId: string,
    apiId: string,
    limit: number,
): Promise<HealthCheckRecord[]> {
    try {
        const history = await findOwnedHealthHistory(userId, apiId, limit);
        if (!history) {
            throw new HealthApiNotFoundError();
        }
        return history;
    } catch (error) {
        if (error instanceof HealthApiNotFoundError) {
            throw error;
        }
        throw new HealthMonitoringUnavailableError(
            'Failed to load API health history.',
            error,
        );
    }
}

export async function runScheduledHealthChecks(
    signal?: AbortSignal,
): Promise<number> {
    let scheduled: Awaited<ReturnType<typeof findScheduledHealthChecks>>;
    try {
        scheduled = await findScheduledHealthChecks();
    } catch (error) {
        throw new HealthMonitoringUnavailableError(
            'Failed to load APIs for scheduled health checks.',
            error,
        );
    }

    if (signal?.aborted) {
        return HEALTH_CHECK_INTERVAL_MS;
    }

    const cycleStartedAt = Date.now();
    const nextCheckAt = new Map<string, number>();
    let nextIndex = 0;
    const workerCount = Math.min(MAX_CONCURRENT_CHECKS, scheduled.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < scheduled.length) {
            if (signal?.aborted) {
                return;
            }

            const item = scheduled[nextIndex];
            nextIndex += 1;
            if (!isScheduledHealthCheckDue(item, cycleStartedAt)) {
                continue;
            }

            let checkedAt: number;
            try {
                const result = await runCheck(
                    item.target,
                    item.config,
                    false,
                    true,
                    signal,
                );
                checkedAt = result
                    ? new Date(result.checkedAt).getTime()
                    : Date.now();
            } catch (error) {
                if (error instanceof ScheduledCheckCancelledError) {
                    return;
                }
                console.error(
                    `Scheduled health check failed for API ${item.target.id}:`,
                    error,
                );
                checkedAt = Date.now();
            }
            nextCheckAt.set(
                item.target.id,
                checkedAt + item.config.intervalSeconds * 1_000,
            );
        }
    });

    await Promise.all(workers);
    return getNextHealthCheckDelay(scheduled, Date.now(), nextCheckAt);
}

export const HEALTH_CHECK_INTERVAL_MS = 60_000;
