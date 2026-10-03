import database from '../config/database.js';

import type {
    Api,
    CreateApiInput,
    UpdateApiInput,
} from './api-types.js';

interface ApiRow {
    id: string;
    project_id: string;
    name: string;
    description: string | null;
    upstream_url: string;
    upstream_base_path: string | null;
    status: Api['status'];
    version: number;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

function mapApi(row: ApiRow): Api {
    return {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        description: row.description,
        upstreamUrl: row.upstream_url,
        upstreamBasePath: row.upstream_base_path,
        status: row.status,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        deletedAt: row.deleted_at?.toISOString() ?? null,
    };
}

export async function findApisByProjectId(
    userId: string,
    projectId: string,
): Promise<Api[]> {
    const rows = await database<ApiRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.project_id': projectId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', [
            'REGISTERED',
            'ACTIVE',
            'DISABLED',
        ])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('apis.*')
        .orderBy('apis.created_at', 'desc');

    return rows.map(mapApi);
}

export async function findApiById(
    userId: string,
    apiId: string,
): Promise<Api | null> {
    const row = await database<ApiRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.id': apiId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', [
            'REGISTERED',
            'ACTIVE',
            'DISABLED',
        ])
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('apis.*')
        .first();

    return row ? mapApi(row) : null;
}

export async function findApiByName(
    userId: string,
    projectId: string,
    name: string,
): Promise<Api | null> {
    const row = await database<ApiRow>('apis')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'apis.project_id': projectId,
            'apis.name': name,
            'projects.user_id': userId,
        })
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('apis.*')
        .first();

    return row ? mapApi(row) : null;
}

export async function createApi(
    projectId: string,
    input: CreateApiInput,
): Promise<Api> {
    const [row] = await database<ApiRow>('apis')
        .insert({
            project_id: projectId,
            name: input.name,
            description: input.description ?? null,
            upstream_url: input.upstreamUrl,
            upstream_base_path: input.upstreamBasePath ?? null,
        })
        .returning('*');

    return mapApi(row);
}

export async function updateApi(
    userId: string,
    apiId: string,
    input: UpdateApiInput,
): Promise<Api | null> {
    const updateData: Record<string, unknown> = {
        version: database.raw('version + 1'),
        updated_at: database.fn.now(),
    };

    if (input.name !== undefined) {
        updateData.name = input.name;
    }

    if (input.description !== undefined) {
        updateData.description = input.description;
    }

    if (input.upstreamUrl !== undefined) {
        updateData.upstream_url = input.upstreamUrl;
    }

    if (input.upstreamBasePath !== undefined) {
        updateData.upstream_base_path = input.upstreamBasePath;
    }

    const [row] = await database<ApiRow>('apis')
        .where('apis.id', apiId)
        .whereIn(
            'apis.project_id',
            database('projects')
                .select('projects.id')
                .where('projects.user_id', userId)
                .whereNull('projects.deleted_at'),
        )
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .update(updateData)
        .returning('*');

    return row ? mapApi(row) : null;
}

export async function updateApiStatus(
    userId: string,
    apiId: string,
    status: 'ACTIVE' | 'DISABLED',
): Promise<Api | null> {
    const [row] = await database<ApiRow>('apis')
        .where('apis.id', apiId)
        .whereIn(
            'apis.project_id',
            database('projects')
                .select('projects.id')
                .where('projects.user_id', userId)
                .whereNull('projects.deleted_at'),
        )
        .whereIn('apis.status', ['REGISTERED', 'ACTIVE', 'DISABLED'])
        .whereNull('apis.deleted_at')
        .update({
            status,
            version: database.raw('version + 1'),
            updated_at: database.fn.now(),
        })
        .returning('*');

    return row ? mapApi(row) : null;
}

export async function softDeleteApi(
    userId: string,
    apiId: string,
): Promise<boolean> {
    return database.transaction(async (trx) => {
        const updatedRows = await trx('apis')
            .where('apis.id', apiId)
            .whereIn(
                'apis.project_id',
                trx('projects')
                    .select('id')
                    .where('user_id', userId)
                    .whereNull('deleted_at'),
            )
            .whereIn('status', [
                'REGISTERED',
                'ACTIVE',
                'DISABLED',
            ])
            .whereNull('deleted_at')
            .update({
                status: 'DELETED',
                deleted_at: trx.fn.now(),
                updated_at: trx.fn.now(),
            });

        if (updatedRows === 0) {
            return false;
        }

        await trx('api_routes')
            .where({
                api_id: apiId,
            })
            .whereNull('deleted_at')
            .update({
                is_active: false,
                deleted_at: trx.fn.now(),
                updated_at: trx.fn.now(),
            });

        return true;
    });
}