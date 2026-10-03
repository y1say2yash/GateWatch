import database from '../config/database.js';

import type {
    CreateProjectInput,
    Project,
    UpdateProjectInput,
} from './project-types.js';

interface ProjectRow {
    id: string;
    user_id: string;
    name: string;
    slug: string;
    description: string | null;
    status: Project['status'];
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

function mapProject(row: ProjectRow): Project {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        deletedAt: row.deleted_at?.toISOString() ?? null,
    };
}

export async function findProjectsByUserId(
    userId: string,
): Promise<Project[]> {
    const rows = await database<ProjectRow>('projects')
        .where({
            user_id: userId,
            status: 'ACTIVE',
        })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc');

    return rows.map(mapProject);
}

export async function findProjectById(
    userId: string,
    projectId: string,
): Promise<Project | null> {
    const row = await database<ProjectRow>('projects')
        .where({
            id: projectId,
            user_id: userId,
            status: 'ACTIVE',
        })
        .whereNull('deleted_at')
        .first();

    return row ? mapProject(row) : null;
}

export async function findProjectBySlug(
    slug: string,
): Promise<Project | null> {
    const row = await database<ProjectRow>('projects')
        .where({
            slug,
            status: 'ACTIVE',
        })
        .whereNull('deleted_at')
        .first();

    return row ? mapProject(row) : null;
}

export async function createProject(
    userId: string,
    input: CreateProjectInput,
): Promise<Project> {
    const [row] = await database<ProjectRow>('projects')
        .insert({
            user_id: userId,
            name: input.name,
            slug: input.slug,
            description: input.description ?? null,
        })
        .returning('*');

    return mapProject(row);
}

export async function updateProject(
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
): Promise<Project | null> {
    const [row] = await database<ProjectRow>('projects')
        .where({
            id: projectId,
            user_id: userId,
            status: 'ACTIVE',
        })
        .whereNull('deleted_at')
        .update({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.slug !== undefined && { slug: input.slug }),
            ...(input.description !== undefined && {
                description: input.description,
            }),
            updated_at: database.fn.now(),
        })
        .returning('*');

    return row ? mapProject(row) : null;
}

export async function softDeleteProject(
    userId: string,
    projectId: string,
): Promise<boolean> {
    const updatedRows = await database('projects')
        .where({
            id: projectId,
            user_id: userId,
            status: 'ACTIVE',
        })
        .whereNull('deleted_at')
        .update({
            status: 'DELETED',
            deleted_at: database.fn.now(),
            updated_at: database.fn.now(),
        });

    return updatedRows > 0;
}