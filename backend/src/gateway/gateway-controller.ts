import type { Request, Response } from 'express';

import type { ApiRoute } from '../routes/route-types.js';

import {
    proxyGatewayRequest,
    RequestBodyTooLargeError,
    UpstreamConnectionError,
    UpstreamResponseTooLargeError,
    UpstreamTimeoutError,
} from './gateway-proxy.js';

import {
    GatewayRouteNotFoundError,
    resolveGatewayRoute,
} from './gateway-service.js';

import { authenticateApiKey } from '../api-keys/api-key-service.js';
import {
    consumeGatewayRateLimit,
    getGatewayRateLimitConfig,
    RateLimitUnavailableError,
} from '../rate-limits/rate-limit-service.js';

type GatewayAuthenticationResult =
    | { authenticated: true; keyId: string }
    | {
        authenticated: false;
        code: 'API_KEY_REQUIRED' | 'INVALID_API_KEY';
        message: string;
    };

function getGatewayPath(
    request: Request,
): string {
    const gatewayPath = request.params.gatewayPath;

    if (Array.isArray(gatewayPath)) {
        return `/${gatewayPath.join('/')}`;
    }

    if (gatewayPath) {
        return `/${gatewayPath}`;
    }

    return '/';
}

function getProjectSlug(
    request: Request,
): string | null {
    const projectSlug = request.params.projectSlug;

    if (Array.isArray(projectSlug)) {
        return projectSlug[0] ?? null;
    }

    return projectSlug || null;
}

function isRouteMethod(
    method: string,
): method is ApiRoute['method'] {
    return [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
    ].includes(method);
}

function sendGatewayError(
    response: Response,
    status: number,
    code: string,
    message: string,
): void {
    if (response.headersSent) {
        response.destroy();
        return;
    }

    response.status(status).json({
        error: {
            code,
            message,
        },
    });
}

async function authenticateGatewayClient(
    request: Request,
    apiId: string,
): Promise<GatewayAuthenticationResult> {
    const suppliedKey = request.headers['x-api-key'];

    if (
        typeof suppliedKey !== 'string' ||
        suppliedKey.trim().length === 0
    ) {
        return {
            authenticated: false,
            code: 'API_KEY_REQUIRED',
            message: 'A valid API key is required for this API.',
        };
    }

    const authenticatedKey = await authenticateApiKey(
        suppliedKey.trim(),
    );

    if (
        !authenticatedKey ||
        authenticatedKey.apiId !== apiId
    ) {
        return {
            authenticated: false,
            code: 'INVALID_API_KEY',
            message: 'The supplied API key is invalid for this API.',
        };
    }

    return {
        authenticated: true,
        keyId: authenticatedKey.id,
    };
}

export async function handleGatewayRequest(
    request: Request,
    response: Response,
): Promise<void> {
    const projectSlug = getProjectSlug(request);
    const gatewayPath = getGatewayPath(request);

    if (!projectSlug) {
        sendGatewayError(
            response,
            404,
            'GATEWAY_ROUTE_NOT_FOUND',
            'Gateway route not found.',
        );
        return;
    }

    if (!isRouteMethod(request.method)) {
        sendGatewayError(
            response,
            405,
            'METHOD_NOT_ALLOWED',
            'HTTP method is not supported.',
        );
        return;
    }

    try {
        const resolution =
            await resolveGatewayRoute(
                projectSlug,
                gatewayPath,
                request.method,
            );

        if (resolution.api.status === 'DISABLED') {
            sendGatewayError(
                response,
                503,
                'API_DISABLED',
                'The requested API is currently disabled.',
            );
            return;
        }

        const rateLimitConfig = await getGatewayRateLimitConfig(
            resolution.api.id,
        );
        let authentication: GatewayAuthenticationResult | null = null;

        if (resolution.api.authRequired) {
            try {
                authentication = await authenticateGatewayClient(
                    request,
                    resolution.api.id,
                );
            } catch (error) {
                console.error('Gateway API-key authentication failed:', error);
                sendGatewayError(
                    response,
                    503,
                    'API_KEY_AUTHENTICATION_UNAVAILABLE',
                    'API-key authentication is temporarily unavailable.',
                );
                return;
            }
        }

        if (rateLimitConfig.enabled) {
            const clientIdentity =
                authentication?.authenticated
                    ? `api-key:${authentication.keyId}`
                    : `ip:${request.ip || request.socket.remoteAddress || 'unknown'}`;
            const rateLimit = await consumeGatewayRateLimit(
                resolution.api.id,
                clientIdentity,
                rateLimitConfig,
            );

            response.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
            response.setHeader(
                'X-RateLimit-Remaining',
                String(rateLimit.remaining),
            );
            response.setHeader('X-RateLimit-Reset', String(rateLimit.resetAt));

            if (!rateLimit.allowed) {
                const retryAfter = Math.max(
                    1,
                    Math.ceil(rateLimit.resetAt - Date.now() / 1000),
                );
                response.setHeader('Retry-After', String(retryAfter));
                sendGatewayError(
                    response,
                    429,
                    'RATE_LIMIT_EXCEEDED',
                    'The request rate limit has been exceeded.',
                );
                return;
            }
        }

        if (
            authentication &&
            !authentication.authenticated
        ) {
            sendGatewayError(
                response,
                401,
                authentication.code,
                authentication.message,
            );
            return;
        }

        await proxyGatewayRequest(
            request,
            response,
            resolution.api,
            resolution.route,
            gatewayPath,
        );
    } catch (error) {
        if (error instanceof RateLimitUnavailableError) {
            console.error('Gateway rate limiting failed:', error);
            sendGatewayError(
                response,
                503,
                'RATE_LIMIT_UNAVAILABLE',
                'Rate limiting is temporarily unavailable.',
            );
            return;
        }

        if (
            error instanceof
            GatewayRouteNotFoundError
        ) {
            sendGatewayError(
                response,
                404,
                'GATEWAY_ROUTE_NOT_FOUND',
                'Gateway route not found.',
            );
            return;
        }

        if (
            error instanceof
            RequestBodyTooLargeError
        ) {
            sendGatewayError(
                response,
                413,
                'REQUEST_BODY_TOO_LARGE',
                'Request body exceeds the maximum allowed size.',
            );
            return;
        }

        if (
            error instanceof
            UpstreamTimeoutError
        ) {
            sendGatewayError(
                response,
                504,
                'UPSTREAM_TIMEOUT',
                'Upstream API request timed out.',
            );
            return;
        }

        if (
            error instanceof
            UpstreamConnectionError
        ) {
            sendGatewayError(
                response,
                502,
                'UPSTREAM_CONNECTION_FAILED',
                'Failed to connect to upstream API.',
            );
            return;
        }

        if (
            error instanceof
            UpstreamResponseTooLargeError
        ) {
            sendGatewayError(
                response,
                502,
                'UPSTREAM_RESPONSE_TOO_LARGE',
                'Upstream response exceeds the maximum allowed size.',
            );
            return;
        }

        console.error(
            'Gateway request failed:',
            error,
        );

        sendGatewayError(
            response,
            502,
            'GATEWAY_REQUEST_FAILED',
            'Gateway request failed.',
        );
    }
}