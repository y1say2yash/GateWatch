export const ROUTE_METHODS = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
] as const;

export type RouteMethod = (typeof ROUTE_METHODS)[number];

export interface ApiRoute {
    id: string;
    apiId: string;
    pathPrefix: string;
    method: RouteMethod;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface CreateRouteInput {
    pathPrefix: string;
    method: RouteMethod;
}

export interface UpdateRouteInput {
    pathPrefix?: string;
    method?: RouteMethod;
    isActive?: boolean;
}