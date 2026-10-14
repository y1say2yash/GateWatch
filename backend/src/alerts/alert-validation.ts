import type {
    AlertConfiguration,
    AlertType,
    CreateAlertInput,
    UpdateAlertInput,
} from './alert-types.js';

export class AlertValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AlertValidationError';
    }
}

const ALERT_TYPES: readonly AlertType[] = [
    'API_DOWN',
    'UNHEALTHY_DURATION',
    'ERROR_RATE',
    'LATENCY',
];
const MAX_WINDOW_SECONDS = 86_400;
const MIN_WINDOW_SECONDS = 60;

function isObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: readonly string[],
    description: string,
): void {
    const unknownField = Object.keys(value).find(
        (field) => !allowed.includes(field),
    );
    if (unknownField) {
        throw new AlertValidationError(
            `Unsupported ${description} field: ${unknownField}.`,
        );
    }
}

function validateName(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value.trim().length > 100
    ) {
        throw new AlertValidationError(
            'name must be a non-empty string of at most 100 characters.',
        );
    }
    return value.trim();
}

function validateType(value: unknown): AlertType {
    if (
        typeof value !== 'string' ||
        !ALERT_TYPES.includes(value as AlertType)
    ) {
        throw new AlertValidationError(
            'type must be one of API_DOWN, UNHEALTHY_DURATION, ERROR_RATE, or LATENCY.',
        );
    }
    return value as AlertType;
}

function validateInteger(
    value: unknown,
    field: string,
    minimum: number,
    maximum: number,
): number {
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < minimum ||
        value > maximum
    ) {
        throw new AlertValidationError(
            `${field} must be an integer between ${minimum} and ${maximum}.`,
        );
    }
    return value;
}

function validateWindowSeconds(value: unknown): number {
    return validateInteger(
        value,
        'windowSeconds',
        MIN_WINDOW_SECONDS,
        MAX_WINDOW_SECONDS,
    );
}

export function validateAlertConfiguration(
    type: AlertType,
    input: unknown,
): AlertConfiguration {
    if (!isObject(input)) {
        throw new AlertValidationError(
            'configuration must be a JSON object.',
        );
    }

    if (type === 'API_DOWN') {
        rejectUnknownFields(input, [], 'configuration');
        return {};
    }

    if (type === 'UNHEALTHY_DURATION') {
        rejectUnknownFields(
            input,
            ['durationSeconds'],
            'configuration',
        );
        return {
            durationSeconds: validateInteger(
                input.durationSeconds,
                'durationSeconds',
                1,
                604_800,
            ),
        };
    }

    if (type === 'ERROR_RATE') {
        rejectUnknownFields(
            input,
            ['threshold', 'windowSeconds'],
            'configuration',
        );
        const threshold = input.threshold;
        if (
            typeof threshold !== 'number' ||
            !Number.isFinite(threshold) ||
            threshold <= 0 ||
            threshold > 1
        ) {
            throw new AlertValidationError(
                'threshold must be a number greater than 0 and at most 1.',
            );
        }
        return {
            threshold,
            windowSeconds: validateWindowSeconds(input.windowSeconds),
        };
    }

    rejectUnknownFields(
        input,
        ['thresholdMs', 'windowSeconds'],
        'configuration',
    );
    return {
        thresholdMs: validateInteger(
            input.thresholdMs,
            'thresholdMs',
            1,
            60_000,
        ),
        windowSeconds: validateWindowSeconds(input.windowSeconds),
    };
}

export function validateCreateAlertInput(
    input: unknown,
): CreateAlertInput {
    if (!isObject(input)) {
        throw new AlertValidationError('Request body must be a JSON object.');
    }
    rejectUnknownFields(
        input,
        ['name', 'type', 'configuration'],
        'alert',
    );
    const type = validateType(input.type);
    return {
        name: validateName(input.name),
        type,
        configuration: validateAlertConfiguration(type, input.configuration),
    };
}

export function validateUpdateAlertInput(
    input: unknown,
): UpdateAlertInput {
    if (!isObject(input)) {
        throw new AlertValidationError('Request body must be a JSON object.');
    }
    rejectUnknownFields(input, ['name', 'type', 'configuration'], 'alert');
    if (Object.keys(input).length === 0) {
        throw new AlertValidationError(
            'At least one alert field must be provided.',
        );
    }

    const update: UpdateAlertInput = {};
    if (input.name !== undefined) {
        update.name = validateName(input.name);
    }
    if (input.type !== undefined) {
        update.type = validateType(input.type);
    }
    if (input.configuration !== undefined) {
        if (!isObject(input.configuration)) {
            throw new AlertValidationError(
                'configuration must be a JSON object.',
            );
        }
        update.configuration = input.configuration as AlertConfiguration;
    }
    return update;
}
