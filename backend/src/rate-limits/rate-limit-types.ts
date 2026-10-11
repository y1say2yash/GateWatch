export interface RateLimitConfig {
    apiId: string;
    enabled: boolean;
    maxRequests: number;
    windowSeconds: number;
}

export interface RateLimitDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetAt: number;
}
