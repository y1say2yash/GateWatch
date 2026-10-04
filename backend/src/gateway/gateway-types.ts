import type { Api } from '../apis/api-types.js';
import type { ApiRoute } from '../routes/route-types.js';

export interface GatewayResolution {
    api: Api;
    route: ApiRoute;
}

export interface GatewayProxyTarget {
    url: URL;
    path: string;
}