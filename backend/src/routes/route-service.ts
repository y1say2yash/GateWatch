import {
    createRoute,
    findRouteById,
    findRouteByProjectPathAndMethod,
    findRoutesByApiId,
    softDeleteRoute,
    updateRoute,
} from './route-repository.js';

import type {
    CreateRouteInput,
    UpdateRouteInput,
} from './route-types.js';

import {
    validateCreateRouteInput,
    validateUpdateRouteInput,
} from './route-validation.js';

import {
    ApiNotFoundError,
    getUserApi,
} from '../apis/api-service.js';

export class RouteNotFoundError extends Error { }

export class RouteConflictError extends Error { }

export async function listUserApiRoutes(
    userId: string,
    apiId: string,
) {
    try {
        await getUserApi(userId, apiId);
    } catch (error) {
        if (error instanceof ApiNotFoundError) {
            throw new RouteNotFoundError('API not found.');
        }

        throw error;
    }

    return findRoutesByApiId(userId, apiId);
}

export async function createUserApiRoute(
    userId: string,
    apiId: string,
    input: unknown,
) {
    const validatedInput: CreateRouteInput =
        validateCreateRouteInput(input);

    let api;

    try {
        api = await getUserApi(userId, apiId);
    } catch (error) {
        if (error instanceof ApiNotFoundError) {
            throw new RouteNotFoundError('API not found.');
        }

        throw error;
    }

    const duplicate =
        await findRouteByProjectPathAndMethod(
            userId,
            api.projectId,
            validatedInput.pathPrefix,
            validatedInput.method,
        );

    if (duplicate) {
        throw new RouteConflictError(
            'A route with this path prefix and method already exists.',
        );
    }

    return createRoute(
        apiId,
        api.projectId,
        validatedInput,
    );
}

export async function updateUserApiRoute(
    userId: string,
    routeId: string,
    input: unknown,
) {
    const validatedInput: UpdateRouteInput =
        validateUpdateRouteInput(input);

    const existingRoute = await findRouteById(
        userId,
        routeId,
    );

    if (!existingRoute) {
        throw new RouteNotFoundError('Route not found.');
    }

    const nextPathPrefix =
        validatedInput.pathPrefix ??
        existingRoute.pathPrefix;

    const nextMethod =
        validatedInput.method ??
        existingRoute.method;

    if (
        nextPathPrefix !== existingRoute.pathPrefix ||
        nextMethod !== existingRoute.method
    ) {
        const api = await getUserApi(
            userId,
            existingRoute.apiId,
        );

        const duplicate =
            await findRouteByProjectPathAndMethod(
                userId,
                api.projectId,
                nextPathPrefix,
                nextMethod,
            );

        if (duplicate) {
            throw new RouteConflictError(
                'A route with this path prefix and method already exists.',
            );
        }
    }

    const route = await updateRoute(
        userId,
        routeId,
        validatedInput,
    );

    if (!route) {
        throw new RouteNotFoundError('Route not found.');
    }

    return route;
}

export async function deleteUserApiRoute(
    userId: string,
    routeId: string,
): Promise<void> {
    const deleted = await softDeleteRoute(
        userId,
        routeId,
    );

    if (!deleted) {
        throw new RouteNotFoundError('Route not found.');
    }
}
