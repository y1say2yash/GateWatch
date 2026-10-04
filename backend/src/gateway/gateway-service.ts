import type { ApiRoute } from '../routes/route-types.js';

import { findGatewayRoutes } from './gateway-repository.js';
import type { GatewayResolution } from './gateway-types.js';

export class GatewayRouteNotFoundError extends Error {
    constructor() {
        super('Gateway route not found.');
        this.name = 'GatewayRouteNotFoundError';
    }
}

function matchesPath(
    requestPath: string,
    routePrefix: string,
): boolean {
    if (routePrefix === '/') {
        return true;
    }

    return (
        requestPath === routePrefix ||
        requestPath.startsWith(`${routePrefix}/`)
    );
}

export async function resolveGatewayRoute(
    projectSlug: string,
    requestPath: string,
    method: ApiRoute['method'],
): Promise<GatewayResolution> {
    const candidates = await findGatewayRoutes(
        projectSlug,
        method,
    );

    const matchingRoute = candidates
        .filter(({ route }) =>
            matchesPath(
                requestPath,
                route.pathPrefix,
            ),
        )
        .sort(
            (a, b) =>
                b.route.pathPrefix.length -
                a.route.pathPrefix.length,
        )[0];

    if (!matchingRoute) {
        throw new GatewayRouteNotFoundError();
    }

    return matchingRoute;
}
