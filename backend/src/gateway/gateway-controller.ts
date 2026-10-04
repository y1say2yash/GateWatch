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

        await proxyGatewayRequest(
            request,
            response,
            resolution.api,
            resolution.route,
            gatewayPath,
        );
    } catch (error) {
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