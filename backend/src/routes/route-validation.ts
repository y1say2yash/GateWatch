import type {
    CreateRouteInput,
    RouteMethod,
    UpdateRouteInput,
} from './route-types.js';
import { ROUTE_METHODS } from './route-types.js';

export class RouteValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'RouteValidationError';
    }
}

function validatePathPrefix(value: unknown): string {
    if (typeof value !== 'string') {
        throw new RouteValidationError(
            'INVALID_PATH_PREFIX',
            'Path prefix must be a string.',
        );
    }

    const pathPrefix = value.trim();

    if (
        pathPrefix.length < 1 ||
        pathPrefix.length > 2048
    ) {
        throw new RouteValidationError(
            'INVALID_PATH_PREFIX',
            'Path prefix must be between 1 and 2048 characters.',
        );
    }

    if (!pathPrefix.startsWith('/')) {
        throw new RouteValidationError(
            'INVALID_PATH_PREFIX',
            'Path prefix must start with "/".',
        );
    }

    if (pathPrefix.includes('?') || pathPrefix.includes('#')) {
        throw new RouteValidationError(
            'INVALID_PATH_PREFIX',
            'Path prefix must not contain a query string or fragment.',
        );
    }

    if (pathPrefix.length > 1) {
        return pathPrefix.replace(/\/+$/, '');
    }

    return pathPrefix;
}

function validateMethod(value: unknown): RouteMethod {
    if (
        typeof value !== 'string' ||
        !ROUTE_METHODS.includes(value as RouteMethod)
    ) {
        throw new RouteValidationError(
            'INVALID_ROUTE_METHOD',
            `Method must be one of: ${ROUTE_METHODS.join(', ')}.`,
        );
    }

    return value as RouteMethod;
}

function validateIsActive(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        throw new RouteValidationError(
            'INVALID_ROUTE_STATUS',
            'isActive must be a boolean.',
        );
    }

    return value;
}

export function validateCreateRouteInput(
    input: unknown,
): CreateRouteInput {
    if (!input || typeof input !== 'object') {
        throw new RouteValidationError(
            'INVALID_ROUTE_INPUT',
            'Request body must be an object.',
        );
    }

    const body = input as Record<string, unknown>;

    return {
        pathPrefix: validatePathPrefix(body.pathPrefix),
        method: validateMethod(body.method),
    };
}

export function validateUpdateRouteInput(
    input: unknown,
): UpdateRouteInput {
    if (!input || typeof input !== 'object') {
        throw new RouteValidationError(
            'INVALID_ROUTE_INPUT',
            'Request body must be an object.',
        );
    }

    const body = input as Record<string, unknown>;

    const allowedFields = [
        'pathPrefix',
        'method',
        'isActive',
    ];

    const providedFields = Object.keys(body);

    if (providedFields.length === 0) {
        throw new RouteValidationError(
            'EMPTY_ROUTE_UPDATE',
            'At least one route field must be provided.',
        );
    }

    const unknownFields = providedFields.filter(
        (field) => !allowedFields.includes(field),
    );

    if (unknownFields.length > 0) {
        throw new RouteValidationError(
            'INVALID_ROUTE_FIELD',
            `Unsupported route field: ${unknownFields[0]}.`,
        );
    }

    return {
        ...(body.pathPrefix !== undefined && {
            pathPrefix: validatePathPrefix(body.pathPrefix),
        }),
        ...(body.method !== undefined && {
            method: validateMethod(body.method),
        }),
        ...(body.isActive !== undefined && {
            isActive: validateIsActive(body.isActive),
        }),
    };
}