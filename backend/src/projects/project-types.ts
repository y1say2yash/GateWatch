export type ProjectStatus = 'ACTIVE' | 'DELETED';

export interface Project {
    id: string;
    userId: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface CreateProjectInput {
    name: string;
    slug: string;
    description?: string | null;
}

export interface UpdateProjectInput {
    name?: string;
    slug?: string;
    description?: string | null;
}