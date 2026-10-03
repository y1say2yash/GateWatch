import {
    createProject,
    findProjectById,
    findProjectByName,
    findProjectBySlug,
    findProjectsByUserId,
    softDeleteProject,
    updateProject,
} from './project-repository.js';

import {
    validateCreateProjectInput,
    validateUpdateProjectInput,
} from './project-validation.js';

import type { Project } from './project-types.js';

export class ProjectNotFoundError extends Error {
    constructor() {
        super('Project not found.');
        this.name = 'ProjectNotFoundError';
    }
}

export class ProjectNameConflictError extends Error {
    constructor() {
        super('A project with this name already exists.');
        this.name = 'ProjectNameConflictError';
    }
}

export class ProjectSlugConflictError extends Error {
    constructor() {
        super('A project with this slug already exists.');
        this.name = 'ProjectSlugConflictError';
    }
}

export async function listUserProjects(userId: string): Promise<Project[]> {
    return findProjectsByUserId(userId);
}

export async function getUserProject(
    userId: string,
    projectId: string,
): Promise<Project> {
    const project = await findProjectById(userId, projectId);

    if (!project) {
        throw new ProjectNotFoundError();
    }

    return project;
}

export async function createUserProject(
    userId: string,
    input: unknown,
): Promise<Project> {
    const validatedInput = validateCreateProjectInput(input);

    const existingProjectByName = await findProjectByName(
        userId,
        validatedInput.name,
    );

    if (existingProjectByName) {
        throw new ProjectNameConflictError();
    }

    const existingProjectBySlug = await findProjectBySlug(
        validatedInput.slug,
    );

    if (existingProjectBySlug) {
        throw new ProjectSlugConflictError();
    }

    return createProject(userId, validatedInput);
}

export async function updateUserProject(
    userId: string,
    projectId: string,
    input: unknown,
): Promise<Project> {
    const validatedInput = validateUpdateProjectInput(input);

    if (validatedInput.name !== undefined) {
        const existingProject = await findProjectByName(
            userId,
            validatedInput.name,
        );

        if (existingProject && existingProject.id !== projectId) {
            throw new ProjectNameConflictError();
        }
    }

    if (validatedInput.slug !== undefined) {
        const existingProject = await findProjectBySlug(
            validatedInput.slug,
        );

        if (existingProject && existingProject.id !== projectId) {
            throw new ProjectSlugConflictError();
        }
    }

    const project = await updateProject(
        userId,
        projectId,
        validatedInput,
    );

    if (!project) {
        throw new ProjectNotFoundError();
    }

    return project;
}

export async function deleteUserProject(
    userId: string,
    projectId: string,
): Promise<void> {
    const deleted = await softDeleteProject(userId, projectId);

    if (!deleted) {
        throw new ProjectNotFoundError();
    }
}