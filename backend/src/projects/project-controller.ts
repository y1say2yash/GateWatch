import type { Request, Response } from 'express';

import {
    createUserProject,
    deleteUserProject,
    getUserProject,
    listUserProjects,
    ProjectNameConflictError,
    ProjectNotFoundError,
    ProjectSlugConflictError,
    updateUserProject,
} from './project-service.js';

import { ProjectValidationError } from './project-validation.js';

function handleProjectError(error: unknown, response: Response): void {
    if (error instanceof ProjectValidationError) {
        response.status(400).json({
            error: {
                code: error.code,
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof ProjectNameConflictError) {
        response.status(409).json({
            error: {
                code: 'PROJECT_NAME_CONFLICT',
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof ProjectSlugConflictError) {
        response.status(409).json({
            error: {
                code: 'PROJECT_SLUG_CONFLICT',
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof ProjectNotFoundError) {
        response.status(404).json({
            error: {
                code: 'PROJECT_NOT_FOUND',
                message: error.message,
            },
        });

        return;
    }

    console.error('Project operation failed:', error);

    response.status(500).json({
        error: {
            code: 'PROJECT_OPERATION_FAILED',
            message: 'Failed to process project request.',
        },
    });
}

export async function listProjects(
    _request: Request,
    response: Response,
): Promise<void> {
    try {
        const userId = response.locals.user.id;

        const projects = await listUserProjects(userId);

        response.status(200).json({
            data: projects,
        });
    } catch (error) {
        handleProjectError(error, response);
    }
}

export async function createProject(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const userId = response.locals.user.id;

        const project = await createUserProject(
            userId,
            request.body,
        );

        response.status(201).json({
            data: project,
        });
    } catch (error) {
        handleProjectError(error, response);
    }
}

export async function getProject(
    request: Request<{ id: string }>,
    response: Response,
): Promise<void> {
    try {
        const userId = response.locals.user.id;

        const project = await getUserProject(
            userId,
            request.params.id,
        );

        response.status(200).json({
            data: project,
        });
    } catch (error) {
        handleProjectError(error, response);
    }
}

export async function updateProject(
    request: Request<{ id: string }>,
    response: Response,
): Promise<void> {
    try {
        const userId = response.locals.user.id;

        const project = await updateUserProject(
            userId,
            request.params.id,
            request.body,
        );

        response.status(200).json({
            data: project,
        });
    } catch (error) {
        handleProjectError(error, response);
    }
}

export async function deleteProject(
    request: Request<{ id: string }>,
    response: Response,
): Promise<void> {
    try {
        const userId = response.locals.user.id;

        await deleteUserProject(
            userId,
            request.params.id,
        );

        response.status(204).send();
    } catch (error) {
        handleProjectError(error, response);
    }
}