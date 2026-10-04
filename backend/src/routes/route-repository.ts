import database from '../config/database.js';

import type {
    ApiRoute,
    CreateRouteInput,
    UpdateRouteInput,
} from './route-types.js';

interface RouteRow {
    id: string;
    api_id: string;
    project_id: string;
    path_prefix: string;
    method: ApiRoute['method'];
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

function mapRoute(row: RouteRow): ApiRoute {
    return {
        id: row.id,
        apiId: row.api_id,
        pathPrefix: row.path_prefix,
        method: row.method,
        isActive: row.is_active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        deletedAt: row.deleted_at?.toISOString() ?? null,
    };
}

const activeApiStatuses = [
    'REGISTERED',
    'ACTIVE',
    'DISABLED',
];

export async function findRoutesByApiId(
    userId: string,
    apiId: string,
): Promise<ApiRoute[]> {
    const rows = await database<RouteRow>('api_routes')
        .join('apis', 'apis.id', 'api_routes.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'api_routes.api_id': apiId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', activeApiStatuses)
        .whereNull('api_routes.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('api_routes.*')
        .orderBy('api_routes.created_at', 'desc');

    return rows.map(mapRoute);
}

export async function findRouteById(
    userId: string,
    routeId: string,
): Promise<ApiRoute | null> {
    const row = await database<RouteRow>('api_routes')
        .join('apis', 'apis.id', 'api_routes.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'api_routes.id': routeId,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', activeApiStatuses)
        .whereNull('api_routes.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('api_routes.*')
        .first();

    return row ? mapRoute(row) : null;
}

export async function findRouteByPathAndMethod(
    userId: string,
    apiId: string,
    pathPrefix: string,
    method: ApiRoute['method'],
): Promise<ApiRoute | null> {
    const row = await database<RouteRow>('api_routes')
        .join('apis', 'apis.id', 'api_routes.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'api_routes.api_id': apiId,
            'api_routes.path_prefix': pathPrefix,
            'api_routes.method': method,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', activeApiStatuses)
        .whereNull('api_routes.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('api_routes.*')
        .first();

    return row ? mapRoute(row) : null;
}

export async function findRouteByProjectPathAndMethod(
    userId: string,
    projectId: string,
    pathPrefix: string,
    method: ApiRoute['method'],
): Promise<ApiRoute | null> {
    const row = await database<RouteRow>('api_routes')
        .join('apis', 'apis.id', 'api_routes.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'api_routes.project_id': projectId,
            'api_routes.path_prefix': pathPrefix,
            'api_routes.method': method,
            'projects.user_id': userId,
        })
        .whereIn('apis.status', activeApiStatuses)
        .whereNull('api_routes.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('api_routes.*')
        .first();

    return row ? mapRoute(row) : null;
}

export async function createRoute(
    apiId: string,
    projectId: string,
    input: CreateRouteInput,
): Promise<ApiRoute> {
    const [row] = await database<RouteRow>('api_routes')
        .insert({
            api_id: apiId,
            project_id: projectId,
            path_prefix: input.pathPrefix,
            method: input.method,
        })
        .returning('*');

    return mapRoute(row);
}

export async function updateRoute(
    userId: string,
    routeId: string,
    input: UpdateRouteInput,
): Promise<ApiRoute | null> {
    const updateData: Record<string, unknown> = {
        updated_at: database.fn.now(),
    };

    if (input.pathPrefix !== undefined) {
        updateData.path_prefix = input.pathPrefix;
    }

    if (input.method !== undefined) {
        updateData.method = input.method;
    }

    if (input.isActive !== undefined) {
        updateData.is_active = input.isActive;
    }

    const [row] = await database<RouteRow>('api_routes')
        .where('api_routes.id', routeId)
        .whereIn(
            'api_routes.api_id',
            database('apis')
                .select('apis.id')
                .whereIn(
                    'apis.project_id',
                    database('projects')
                        .select('projects.id')
                        .where('projects.user_id', userId)
                        .whereNull('projects.deleted_at'),
                )
                .whereIn('apis.status', [
                    'REGISTERED',
                    'ACTIVE',
                    'DISABLED',
                ])
                .whereNull('apis.deleted_at'),
        )
        .whereNull('api_routes.deleted_at')
        .update(updateData)
        .returning('*');

    return row ? mapRoute(row) : null;
}

export async function softDeleteRoute(
    userId: string,
    routeId: string,
): Promise<boolean> {
    const updatedRows = await database('api_routes')
        .where('api_routes.id', routeId)
        .whereIn(
            'api_routes.api_id',
            database('apis')
                .select('apis.id')
                .whereIn(
                    'apis.project_id',
                    database('projects')
                        .select('projects.id')
                        .where('projects.user_id', userId)
                        .whereNull('projects.deleted_at'),
                )
                .whereIn('apis.status', [
                    'REGISTERED',
                    'ACTIVE',
                    'DISABLED',
                ])
                .whereNull('apis.deleted_at'),
        )
        .whereNull('api_routes.deleted_at')
        .update({
            is_active: false,
            deleted_at: database.fn.now(),
            updated_at: database.fn.now(),
        });

    return updatedRows > 0;
}