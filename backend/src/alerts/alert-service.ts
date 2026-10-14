import {
    createOwnedAlert,
    findOwnedAlert,
    findOwnedApiAlerts,
    setOwnedAlertEnabled,
    softDeleteOwnedAlert,
    updateOwnedAlert,
} from './alert-repository.js';
import type { AlertType } from './alert-types.js';
import {
    validateAlertConfiguration,
    validateCreateAlertInput,
    validateUpdateAlertInput,
} from './alert-validation.js';

export class AlertNotFoundError extends Error {
    constructor() {
        super('Alert or API not found.');
        this.name = 'AlertNotFoundError';
    }
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new AlertNotFoundError();
    }
}

export async function listUserApiAlerts(
    userId: string,
    apiId: string,
) {
    requireUuid(apiId);
    const alerts = await findOwnedApiAlerts(userId, apiId);
    if (!alerts) {
        throw new AlertNotFoundError();
    }
    return alerts;
}

export async function getUserAlert(userId: string, alertId: string) {
    requireUuid(alertId);
    const alert = await findOwnedAlert(userId, alertId);
    if (!alert) {
        throw new AlertNotFoundError();
    }
    return alert;
}

export async function createUserAlert(
    userId: string,
    apiId: string,
    input: unknown,
) {
    requireUuid(apiId);
    const validated = validateCreateAlertInput(input);
    const alert = await createOwnedAlert(userId, apiId, validated);
    if (!alert) {
        throw new AlertNotFoundError();
    }
    return alert;
}

export async function updateUserAlert(
    userId: string,
    alertId: string,
    input: unknown,
) {
    requireUuid(alertId);
    const updates = validateUpdateAlertInput(input);
    const current = await findOwnedAlert(userId, alertId);
    if (!current) {
        throw new AlertNotFoundError();
    }

    const type: AlertType = updates.type ?? current.type;
    const configuration = updates.configuration === undefined &&
        updates.type === undefined
        ? undefined
        : validateAlertConfiguration(
            type,
            updates.configuration ?? current.configuration,
        );
    const alert = await updateOwnedAlert(userId, alertId, {
        ...updates,
        ...(configuration !== undefined && { configuration }),
    });
    if (!alert) {
        throw new AlertNotFoundError();
    }
    return alert;
}

export async function setUserAlertEnabled(
    userId: string,
    alertId: string,
    enabled: boolean,
) {
    requireUuid(alertId);
    const alert = await setOwnedAlertEnabled(userId, alertId, enabled);
    if (!alert) {
        throw new AlertNotFoundError();
    }
    return alert;
}

export async function deleteUserAlert(
    userId: string,
    alertId: string,
): Promise<void> {
    requireUuid(alertId);
    const deleted = await softDeleteOwnedAlert(userId, alertId);
    if (!deleted) {
        throw new AlertNotFoundError();
    }
}
