import type { RateLimitConfig } from './rate-limit-types.js';

const MAX_REQUESTS = 1_000_000;
const MAX_WINDOW_SECONDS = 86_400;

export class RateLimitValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitValidationError';
    }
}

function isBoundedPositiveInteger(
    value: unknown,
    maximum: number,
): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        value <= maximum
    );
}

export function validateRateLimitConfig(
    input: unknown,
): Partial<Pick<
    RateLimitConfig,
    'enabled' | 'maxRequests' | 'windowSeconds'
>> {
    if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input)
    ) {
        throw new RateLimitValidationError(
            'Request body must be a JSON object.',
        );
    }

    const body = input as Record<string, unknown>;
    const fields = Object.keys(body);

    if (fields.length === 0) {
        throw new RateLimitValidationError(
            'At least one rate-limit field must be provided.',
        );
    }

    const unknownFields = fields.filter(
        (field) => !['enabled', 'maxRequests', 'windowSeconds'].includes(field),
    );

    if (unknownFields.length > 0) {
        throw new RateLimitValidationError(
            `Unsupported rate-limit field: ${unknownFields[0]}.`,
        );
    }

    const enabled = body.enabled;
    const maxRequests = body.maxRequests;
    const windowSeconds = body.windowSeconds;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new RateLimitValidationError(
            'enabled must be a boolean.',
        );
    }

    if (
        maxRequests !== undefined &&
        !isBoundedPositiveInteger(maxRequests, MAX_REQUESTS)
    ) {
        throw new RateLimitValidationError(
            `maxRequests must be a positive integer no greater than ${MAX_REQUESTS}.`,
        );
    }

    if (
        windowSeconds !== undefined &&
        !isBoundedPositiveInteger(windowSeconds, MAX_WINDOW_SECONDS)
    ) {
        throw new RateLimitValidationError(
            `windowSeconds must be a positive integer no greater than ${MAX_WINDOW_SECONDS}.`,
        );
    }

    return {
        ...(enabled !== undefined && {
            enabled,
        }),
        ...(maxRequests !== undefined && {
            maxRequests,
        }),
        ...(windowSeconds !== undefined && {
            windowSeconds,
        }),
    };
}
