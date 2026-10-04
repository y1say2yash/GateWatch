import database from '../config/database.js';

import type { Api } from '../apis/api-types.js';
import type { ApiRoute } from '../routes/route-types.js';

interface GatewayRouteRow {
    route_id: string;
    route_project_id: string;
    api_id: string;
    api_project_id: string;
    api_name: string;
    api_description: string | null;
    api_upstream_url: string;
    api_upstream_base_path: string | null;
    api_status: Api['status'];
    api_version: number;
    api_created_at: Date;
    api_updated_at: Date;
    api_deleted_at: Date | null;
    route_path_prefix: string;
    route_method: ApiRoute['method'];
    route_is_active: boolean;
    route_created_at: Date;
    route_updated_at: Date;
    route_deleted_at: Date | null;
}

function mapApi(row: GatewayRouteRow): Api {
    return {
        id: row.api_id,
        projectId: row.api_project_id,
        name: row.api_name,
        description: row.api_description,
        upstreamUrl: row.api_upstream_url,
        upstreamBasePath: row.api_upstream_base_path,
        status: row.api_status,
        version: row.api_version,
        createdAt: row.api_created_at.toISOString(),
        updatedAt: row.api_updated_at.toISOString(),
        deletedAt: row.api_deleted_at?.toISOString() ?? null,
    };
}

function mapRoute(row: GatewayRouteRow): ApiRoute {
    return {
        id: row.route_id,
        apiId: row.api_id,
        pathPrefix: row.route_path_prefix,
        method: row.route_method,
        isActive: row.route_is_active,
        createdAt: row.route_created_at.toISOString(),
        updatedAt: row.route_updated_at.toISOString(),
        deletedAt: row.route_deleted_at?.toISOString() ?? null,
    };
}

export async function findGatewayRoutes(
    projectSlug: string,
    method: ApiRoute['method'],
): Promise<Array<{ api: Api; route: ApiRoute }>> {
    const rows = await database<GatewayRouteRow>('api_routes')
        .join('apis', 'apis.id', 'api_routes.api_id')
        .join('projects', 'projects.id', 'api_routes.project_id')
        .where({
            'projects.slug': projectSlug,
            'api_routes.method': method,
            'projects.status': 'ACTIVE',
        })
        .whereIn('apis.status', [
            'REGISTERED',
            'ACTIVE',
            'DISABLED',
        ])
        .where('api_routes.is_active', true)
        .whereNull('projects.deleted_at')
        .whereNull('apis.deleted_at')
        .whereNull('api_routes.deleted_at')
        .select([
            'api_routes.id as route_id',
            'api_routes.project_id as route_project_id',
            'api_routes.api_id as api_id',
            'apis.project_id as api_project_id',
            'apis.name as api_name',
            'apis.description as api_description',
            'apis.upstream_url as api_upstream_url',
            'apis.upstream_base_path as api_upstream_base_path',
            'apis.status as api_status',
            'apis.version as api_version',
            'apis.created_at as api_created_at',
            'apis.updated_at as api_updated_at',
            'apis.deleted_at as api_deleted_at',
            'api_routes.path_prefix as route_path_prefix',
            'api_routes.method as route_method',
            'api_routes.is_active as route_is_active',
            'api_routes.created_at as route_created_at',
            'api_routes.updated_at as route_updated_at',
            'api_routes.deleted_at as route_deleted_at',
        ]);

    return rows.map((row) => ({
        api: mapApi(row),
        route: mapRoute(row),
    }));
}