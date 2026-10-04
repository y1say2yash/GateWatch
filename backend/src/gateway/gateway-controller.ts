import type { Request, Response } from 'express';

export function handleGatewayRequest(
    request: Request,
    response: Response,
): void {
    const projectSlug = request.params.projectSlug;
    const gatewayPath = request.params.gatewayPath;

    const path = Array.isArray(gatewayPath)
        ? `/${gatewayPath.join('/')}`
        : gatewayPath
            ? `/${gatewayPath}`
            : '/';

    response.status(200).json({
        message: 'Gateway entry point reached.',
        projectSlug,
        path,
        method: request.method,
    });
}