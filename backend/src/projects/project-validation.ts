import type {
    CreateProjectInput,
    UpdateProjectInput,
} from './project-types.js';

const PROJECT_NAME_MAX_LENGTH = 100;
const PROJECT_SLUG_MAX_LENGTH = 100;

const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateCreateProjectInput(
    input: unknown,
): CreateProjectInput {
    if (!isRecord(input)) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_DATA',
            'Project data must be an object.',
        );
    }

    const name = validateName(input.name);
    const slug = validateSlug(input.slug);
    const description = validateDescription(input.description);

    return {
        name,
        slug,
        description,
    };
}

export function validateUpdateProjectInput(
    input: unknown,
): UpdateProjectInput {
    if (!isRecord(input)) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_DATA',
            'Project data must be an object.',
        );
    }

    const keys = Object.keys(input);

    if (keys.length === 0) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_DATA',
            'At least one project field must be provided.',
        );
    }

    const allowedFields = new Set(['name', 'slug', 'description']);

    if (keys.some((key) => !allowedFields.has(key))) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_DATA',
            'Only name, slug, and description can be updated.',
        );
    }

    const update: UpdateProjectInput = {};

    if ('name' in input) {
        update.name = validateName(input.name);
    }

    if ('slug' in input) {
        update.slug = validateSlug(input.slug);
    }

    if ('description' in input) {
        update.description = validateDescription(input.description);
    }

    return update;
}

function validateName(value: unknown): string {
    if (typeof value !== 'string') {
        throw new ProjectValidationError(
            'INVALID_PROJECT_NAME',
            'Project name must be a string.',
        );
    }

    const name = value.trim();

    if (name.length === 0 || name.length > PROJECT_NAME_MAX_LENGTH) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_NAME',
            `Project name must be between 1 and ${PROJECT_NAME_MAX_LENGTH} characters.`,
        );
    }

    return name;
}

function validateSlug(value: unknown): string {
    if (typeof value !== 'string') {
        throw new ProjectValidationError(
            'INVALID_PROJECT_SLUG',
            'Project slug must be a string.',
        );
    }

    const slug = value.trim().toLowerCase();

    if (slug.length === 0 || slug.length > PROJECT_SLUG_MAX_LENGTH) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_SLUG',
            `Project slug must be between 1 and ${PROJECT_SLUG_MAX_LENGTH} characters.`,
        );
    }

    if (!PROJECT_SLUG_PATTERN.test(slug)) {
        throw new ProjectValidationError(
            'INVALID_PROJECT_SLUG',
            'Project slug may contain only lowercase letters, numbers, and single hyphens between them.',
        );
    }

    return slug;
}

function validateDescription(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new ProjectValidationError(
            'INVALID_PROJECT_DESCRIPTION',
            'Project description must be a string or null.',
        );
    }

    return value.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ProjectValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ProjectValidationError';
    }
}