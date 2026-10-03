import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';

import {
    createRouteController,
    deleteRouteController,
    listRoutes,
    updateRouteController,
} from './route-controller.js';

const router = Router();

router.use(requireAuthentication);

router.get(
    '/apis/:apiId/routes',
    listRoutes,
);

router.post(
    '/apis/:apiId/routes',
    createRouteController,
);

router.patch(
    '/routes/:routeId',
    updateRouteController,
);

router.delete(
    '/routes/:routeId',
    deleteRouteController,
);

export default router;