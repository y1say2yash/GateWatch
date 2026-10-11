import {
    HEALTH_CHECK_INTERVAL_MS,
    runScheduledHealthChecks,
} from './health-service.js';

let timer: ReturnType<typeof setTimeout> | null = null;
let runningCheck: Promise<void> | null = null;
let runningController: AbortController | null = null;
let schedulerStarted = false;
let refreshRequested = false;

function triggerScheduledChecks(): void {
    timer = null;
    if (!schedulerStarted || runningCheck) {
        return;
    }

    const controller = new AbortController();
    runningController = controller;
    runningCheck = (async () => {
        let nextDelay = HEALTH_CHECK_INTERVAL_MS;
        try {
            nextDelay = await runScheduledHealthChecks(controller.signal);
        } catch (error) {
            console.error('Scheduled health-check cycle failed:', error);
        } finally {
            runningCheck = null;
            runningController = null;
            const delay = refreshRequested ? 0 : nextDelay;
            refreshRequested = false;
            if (schedulerStarted) {
                timer = setTimeout(triggerScheduledChecks, delay);
            }
        }
    })();
}

export function startHealthScheduler(): void {
    if (schedulerStarted) {
        return;
    }

    schedulerStarted = true;
    triggerScheduledChecks();
}

export function rescheduleHealthChecks(): void {
    if (!schedulerStarted) {
        return;
    }

    refreshRequested = true;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!runningCheck) {
        refreshRequested = false;
        triggerScheduledChecks();
    }
}

export async function stopHealthScheduler(): Promise<void> {
    schedulerStarted = false;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }

    refreshRequested = false;
    runningController?.abort();
    await runningCheck;
}
