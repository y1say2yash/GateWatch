import { Router } from 'express';

import { requireAuthentication } from './session-middleware.js';
import {
    createAccessTokenController,
    listAccessTokensController,
    revokeAccessTokenController,
} from './access-token-controller.js';

const router = Router();

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

router.post(
    '/users/me/access-tokens',
    requireAuthentication,
    createAccessTokenController,
);
router.get(
    '/users/me/access-tokens',
    requireAuthentication,
    listAccessTokensController,
);
router.delete(
    '/access-tokens/:accessTokenId',
    requireAuthentication,
    (request, response, next) => {
        if (!isUuid(request.params.accessTokenId)) {
            response.status(400).json({
                error: {
                    code: 'INVALID_RESOURCE_ID',
                    message: 'Resource ID must be a valid UUID.',
                },
            });
            return;
        }
        next();
    },
    revokeAccessTokenController,
);

export default router;
