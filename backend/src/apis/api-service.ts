import {
    createApi,
    findApiById,
    findApiByName,
    findApisByProjectId,
    softDeleteApi,
    updateApi,
    updateApiStatus,
} from './api-repository.js';

import type {
    CreateApiInput,
    UpdateApiInput,
} from './api-types.js';

import {
    validateCreateApiInput,
    validateUpdateApiInput,
} from './api-validation.js';

import {
    ProjectNotFoundError,
    getUserProject,
} from '../projects/project-service.js';

export class ApiNotFoundError extends Error { }

export class ApiNameConflictError extends Error { }

export async function listUserProjectApis(
    userId: string,
    projectId: string,
) {
    try {
        await getUserProject(userId, projectId);
    } catch (error) {
        if (error instanceof ProjectNotFoundError) {
            throw new ApiNotFoundError('Project not found.');
        }

        throw error;
    }

    return findApisByProjectId(userId, projectId);
}

export async function getUserApi(
    userId: string,
    apiId: string,
) {
    const api = await findApiById(userId, apiId);

    if (!api) {
        throw new ApiNotFoundError('API not found.');
    }

    return api;
}

export async function createUserApi(
    userId: string,
    projectId: string,
    input: unknown,
) {
    const validatedInput: CreateApiInput =
        validateCreateApiInput(input);

    try {
        await getUserProject(userId, projectId);
    } catch (error) {
        if (error instanceof ProjectNotFoundError) {
            throw new ApiNotFoundError('Project not found.');
        }

        throw error;
    }

    const existingApi = await findApiByName(
        userId,
        projectId,
        validatedInput.name,
    );

    if (existingApi) {
        throw new ApiNameConflictError(
            'An API with this name already exists in the project.',
        );
    }

    return createApi(projectId, validatedInput);
}

export async function updateUserApi(
    userId: string,
    apiId: string,
    input: unknown,
) {
    const validatedInput: UpdateApiInput =
        validateUpdateApiInput(input);

    const existingApi = await findApiById(userId, apiId);

    if (!existingApi) {
        throw new ApiNotFoundError('API not found.');
    }

    if (
        validatedInput.name !== undefined &&
        validatedInput.name !== existingApi.name
    ) {
        const duplicateApi = await findApiByName(
            userId,
            existingApi.projectId,
            validatedInput.name,
        );

        if (duplicateApi) {
            throw new ApiNameConflictError(
                'An API with this name already exists in the project.',
            );
        }
    }

    const api = await updateApi(
        userId,
        apiId,
        validatedInput,
    );

    if (!api) {
        throw new ApiNotFoundError('API not found.');
    }

    return api;
}

export async function deleteUserApi(
    userId: string,
    apiId: string,
): Promise<void> {
    const deleted = await softDeleteApi(userId, apiId);

    if (!deleted) {
        throw new ApiNotFoundError('API not found.');
    }
}

export async function enableUserApi(
    userId: string,
    apiId: string,
) {
    const api = await updateApiStatus(
        userId,
        apiId,
        'ACTIVE',
    );

    if (!api) {
        throw new ApiNotFoundError('API not found.');
    }

    return api;
}

export async function disableUserApi(
    userId: string,
    apiId: string,
) {
    const api = await updateApiStatus(
        userId,
        apiId,
        'DISABLED',
    );

    if (!api) {
        throw new ApiNotFoundError('API not found.');
    }

    return api;
}