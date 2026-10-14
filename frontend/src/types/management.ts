export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'ACTIVE' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ApiStatus = 'REGISTERED' | 'ACTIVE' | 'DISABLED' | 'DELETED';
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface Api {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  upstreamUrl: string;
  upstreamBasePath: string | null;
  status: ApiStatus;
  authRequired: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

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

export interface RateLimitConfig {
  apiId: string;
  enabled: boolean;
  maxRequests: number;
  windowSeconds: number;
}

export interface HealthCheckConfig {
  apiId: string;
  enabled: boolean;
  path: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  latencyThresholdMs: number;
}

export interface HealthStatusResult {
  apiId: string;
  healthStatus: HealthStatus;
  lastHealthCheckAt: string | null;
  latestCheck: {
    status: HealthStatus;
    checkedAt: string;
    responseTimeMs: number | null;
  } | null;
}

export interface ApiKey {
  id: string;
  apiId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  key: string;
}
