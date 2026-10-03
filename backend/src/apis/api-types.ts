export type ApiStatus =
    | 'REGISTERED'
    | 'ACTIVE'
    | 'DISABLED'
    | 'DELETED';

export interface Api {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    upstreamUrl: string;
    upstreamBasePath: string | null;
    status: ApiStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface CreateApiInput {
    name: string;
    description?: string | null;
    upstreamUrl: string;
    upstreamBasePath?: string | null;
}

export interface UpdateApiInput {
    name?: string;
    description?: string | null;
    upstreamUrl?: string;
    upstreamBasePath?: string | null;
}