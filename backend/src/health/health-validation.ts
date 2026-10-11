import type { HealthCheckConfig } from './health-types.js';

type HealthCheckConfigUpdate = Partial<
    Omit<HealthCheckConfig, 'apiId'>
>;

export class HealthConfigValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HealthConfigValidationError';
    }
}

function isIntegerBetween(
    value: unknown,
    minimum: number,
    maximum: number,
): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= minimum &&
        value <= maximum
    );
}

export function validateHealthConfigUpdate(
    input: unknown,
): HealthCheckConfigUpdate {
    if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input)
    ) {
        throw new HealthConfigValidationError(
            'Request body must be a JSON object.',
        );
    }

    const body = input as Record<string, unknown>;
    const fields = Object.keys(body);
    const allowedFields = [
        'enabled',
        'path',
        'intervalSeconds',
        'timeoutMs',
        'expectedStatusMin',
        'expectedStatusMax',
        'latencyThresholdMs',
    ];
    const unknownField = fields.find(
        (field) => !allowedFields.includes(field),
    );

    if (unknownField) {
        throw new HealthConfigValidationError(
            `Unsupported health-check configuration field: ${unknownField}.`,
        );
    }

    if (fields.length === 0) {
        throw new HealthConfigValidationError(
            'At least one health-check configuration field must be provided.',
        );
    }

    const update: HealthCheckConfigUpdate = {};

    if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') {
            throw new HealthConfigValidationError(
                'enabled must be a boolean.',
            );
        }
        update.enabled = body.enabled;
    }

    if (body.path !== undefined) {
        if (
            typeof body.path !== 'string' ||
            !body.path.startsWith('/') ||
            body.path.length > 2048 ||
            body.path.includes('#') ||
            body.path.includes('\r') ||
            body.path.includes('\n')
        ) {
            throw new HealthConfigValidationError(
                'path must be an absolute URL path of at most 2048 characters.',
            );
        }
        update.path = body.path;
    }

    const integerFields = [
        ['intervalSeconds', 1, 86_400],
        ['timeoutMs', 1, 5_000],
        ['expectedStatusMin', 100, 599],
        ['expectedStatusMax', 100, 599],
        ['latencyThresholdMs', 1, 60_000],
    ] as const;

    for (const [field, minimum, maximum] of integerFields) {
        const value = body[field];
        if (value === undefined) {
            continue;
        }

        if (!isIntegerBetween(value, minimum, maximum)) {
            throw new HealthConfigValidationError(
                `${field} must be an integer between ${minimum} and ${maximum}.`,
            );
        }

        if (field === 'intervalSeconds') {
            update.intervalSeconds = value;
        } else if (field === 'timeoutMs') {
            update.timeoutMs = value;
        } else if (field === 'expectedStatusMin') {
            update.expectedStatusMin = value;
        } else if (field === 'expectedStatusMax') {
            update.expectedStatusMax = value;
        } else {
            update.latencyThresholdMs = value;
        }
    }

    return update;
}

export function validateCombinedStatusRange(
    current: HealthCheckConfig,
    update: HealthCheckConfigUpdate,
): void {
    const minimum = update.expectedStatusMin ?? current.expectedStatusMin;
    const maximum = update.expectedStatusMax ?? current.expectedStatusMax;

    if (minimum > maximum) {
        throw new HealthConfigValidationError(
            'expectedStatusMin must not exceed expectedStatusMax.',
        );
    }
}

export type { HealthCheckConfigUpdate };
