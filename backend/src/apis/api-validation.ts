import type {
    CreateApiInput,
    UpdateApiInput,
} from './api-types.js';

export class ApiValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ApiValidationError';
    }
}

function validateName(value: unknown): string {
    if (typeof value !== 'string') {
        throw new ApiValidationError(
            'INVALID_API_NAME',
            'API name must be a string.',
        );
    }

    const name = value.trim();

    if (name.length < 1 || name.length > 100) {
        throw new ApiValidationError(
            'INVALID_API_NAME',
            'API name must be between 1 and 100 characters.',
        );
    }

    return name;
}

function validateDescription(
    value: unknown,
): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new ApiValidationError(
            'INVALID_API_DESCRIPTION',
            'API description must be a string or null.',
        );
    }

    const description = value.trim();

    return description === '' ? null : description;
}

function validateUpstreamUrl(value: unknown): string {
    if (typeof value !== 'string') {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_URL',
            'Upstream URL must be a string.',
        );
    }

    const upstreamUrl = value.trim();

    if (upstreamUrl.length < 1 || upstreamUrl.length > 2048) {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_URL',
            'Upstream URL must be between 1 and 2048 characters.',
        );
    }

    let url: URL;

    try {
        url = new URL(upstreamUrl);
    } catch {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_URL',
            'Upstream URL must be a valid URL.',
        );
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_URL',
            'Upstream URL must use HTTP or HTTPS.',
        );
    }

    return upstreamUrl;
}

function validateUpstreamBasePath(
    value: unknown,
): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === '') {
        return null;
    }

    if (typeof value !== 'string') {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_BASE_PATH',
            'Upstream base path must be a string or null.',
        );
    }

    let basePath = value.trim();

    if (basePath.length > 2048) {
        throw new ApiValidationError(
            'INVALID_UPSTREAM_BASE_PATH',
            'Upstream base path must not exceed 2048 characters.',
        );
    }

    if (!basePath.startsWith('/')) {
        basePath = `/${basePath}`;
    }

    if (basePath.length > 1) {
        basePath = basePath.replace(/\/+$/, '');
    }

    return basePath;
}

export function validateCreateApiInput(
    input: unknown,
): CreateApiInput {
    if (!input || typeof input !== 'object') {
        throw new ApiValidationError(
            'INVALID_API_INPUT',
            'Request body must be an object.',
        );
    }

    const body = input as Record<string, unknown>;

    return {
        name: validateName(body.name),
        description: validateDescription(body.description),
        upstreamUrl: validateUpstreamUrl(body.upstreamUrl),
        upstreamBasePath: validateUpstreamBasePath(
            body.upstreamBasePath,
        ),
    };
}

export function validateUpdateApiInput(
    input: unknown,
): UpdateApiInput {
    if (!input || typeof input !== 'object') {
        throw new ApiValidationError(
            'INVALID_API_INPUT',
            'Request body must be an object.',
        );
    }

    const body = input as Record<string, unknown>;
    const allowedFields = [
        'name',
        'description',
        'upstreamUrl',
        'upstreamBasePath',
    ];

    const providedFields = Object.keys(body);

    if (providedFields.length === 0) {
        throw new ApiValidationError(
            'EMPTY_API_UPDATE',
            'At least one API field must be provided.',
        );
    }

    const unknownFields = providedFields.filter(
        (field) => !allowedFields.includes(field),
    );

    if (unknownFields.length > 0) {
        throw new ApiValidationError(
            'INVALID_API_FIELD',
            `Unsupported API field: ${unknownFields[0]}.`,
        );
    }

    return {
        ...(body.name !== undefined && {
            name: validateName(body.name),
        }),
        ...(body.description !== undefined && {
            description: validateDescription(body.description),
        }),
        ...(body.upstreamUrl !== undefined && {
            upstreamUrl: validateUpstreamUrl(body.upstreamUrl),
        }),
        ...(body.upstreamBasePath !== undefined && {
            upstreamBasePath: validateUpstreamBasePath(
                body.upstreamBasePath,
            ),
        }),
    };
}